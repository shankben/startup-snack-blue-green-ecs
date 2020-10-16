import fs from "fs";
import path from "path";

import {
  Stack,
  Construct,
  StackProps,
  CfnCodeDeployBlueGreenHook,
  CfnTrafficRoutingType,
  Resource,
  CfnElement
} from "@aws-cdk/core";

import { Role, CfnRole } from "@aws-cdk/aws-iam";

import { CfnInclude } from "@aws-cdk/cloudformation-include";
import {
  CfnService,
  AwsLogDriver,
  Cluster,
  ContainerImage,
  FargateService,
  FargateTaskDefinition,
  BaseService,
  CfnTaskSet,
  DeploymentController,
  DeploymentControllerType,
  CfnCluster,
  LaunchType,
  ContainerDefinition,
  CfnPrimaryTaskSet,
  CfnTaskDefinition
} from "@aws-cdk/aws-ecs";

import {
  ApplicationLoadBalancer,
  ApplicationListener,
  ApplicationProtocol,
  ApplicationTargetGroup,
  IApplicationLoadBalancer,
  ListenerCertificate,
  ListenerAction,
  TargetType,
  ApplicationListenerRule,
  CfnTargetGroup,
  CfnListener
} from "@aws-cdk/aws-elasticloadbalancingv2";

import { DockerImageAsset } from "@aws-cdk/aws-ecr-assets";
import { Vpc, SubnetType } from "@aws-cdk/aws-ec2";
import { EcsApplication, CfnDeploymentGroup } from "@aws-cdk/aws-codedeploy";
import {
  ApplicationLoadBalancedFargateService
} from "@aws-cdk/aws-ecs-patterns";


export class EcsCicdStack extends Stack {
  private readonly assetPath = path.join(__dirname, "..", "src")

  private readonly image = ContainerImage
    .fromDockerImageAsset(new DockerImageAsset(this, "Image", {
      directory: path.join(this.assetPath, "fargate", "nginx")
    }));

  private makeTask(color: string): {
    task: FargateTaskDefinition,
    container: ContainerDefinition
  } {
    const task = new FargateTaskDefinition(this, `TaskDef${color}`, {
      family: "nginx",
      cpu: 512,
      memoryLimitMiB: 2048
    });
    const container = task.addContainer("nginx", {
      image: this.image
    });
    container.addPortMappings({
      hostPort: 80,
      containerPort: 80
    });
    return { task, container };
  }

  private makeTargetGroup(color: string, vpc: Vpc): ApplicationTargetGroup {
    return new ApplicationTargetGroup(this, `TargetGroup${color}`, {
      vpc,
      targetGroupName: `nginx-${color}`,
      targetType: TargetType.IP,
      port: 80
    });
  }

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, "Vpc", { maxAzs: 3 });
    const loadBalancer = new ApplicationLoadBalancer(this, "ALB", {
      vpc,
      internetFacing: true
    });
    const blueTargetGroup = this.makeTargetGroup("blue", vpc);
    this.makeTargetGroup("green", vpc);

    const cluster = new Cluster(this, "EcsCluster", { vpc });

    const service = new CfnService(this, "FargateService", {
      cluster: (cluster.node.defaultChild as CfnCluster).ref,
      desiredCount: 1,
      deploymentController: {
        type: DeploymentControllerType.EXTERNAL
      }
    });

    const blueTask = this.makeTask("blue");
    // const greenTask = this.makeTask("green", vpc);

    const listener = new ApplicationListener(this, "PublicListener", {
       loadBalancer,
       protocol: ApplicationProtocol.HTTP,
       port: 80,
       defaultAction: ListenerAction.weightedForward([{
         targetGroup: blueTargetGroup,
         weight: 1
       }])
     });

    const taskSet = new CfnTaskSet(this, "TaskSetBlue", {
      cluster: (cluster.node.defaultChild as CfnCluster).ref,
      launchType: LaunchType.FARGATE,
      service: service.ref,
      taskDefinition: blueTask.task.taskDefinitionArn,
      networkConfiguration: {
        awsVpcConfiguration: {
          subnets: vpc.selectSubnets({
            subnetType: SubnetType.PRIVATE
          }).subnetIds
        }
      },
      loadBalancers: [
        {
          containerName: blueTask.container.containerName,
          containerPort: blueTask.container.containerPort,
          targetGroupArn: blueTargetGroup.targetGroupArn
        }
      ]
    });

    const primaryTaskSet = new CfnPrimaryTaskSet(this, "PrimaryTaskSet", {
      cluster: (cluster.node.defaultChild as CfnCluster).ref,
      service: service.ref,
      taskSetId: taskSet.attrId
    });

    this.addTransform("AWS::CodeDeployBlueGreen");
    const hook = new CfnCodeDeployBlueGreenHook(this, "BlueGreenHook", {
      serviceRole: "AWSCodeDeployRoleForECS",
      trafficRoutingConfig: {
        type: CfnTrafficRoutingType.ALL_AT_ONCE
      },
      applications: [
        {
          target: {
            type: "AWS::ECS::Service",
            logicalId: this.getLogicalId(service)
          },
          ecsAttributes: {
            taskDefinitions: [
              this.getLogicalId(blueTask.task.node
                .defaultChild as CfnTaskDefinition),
              "TaskDefGreen",
            ],
            taskSets: [
              this.getLogicalId(taskSet),
              "TaskSetGreen"
            ],
            trafficRouting: {
              prodTrafficRoute: {
                type: "AWS::ElasticLoadBalancingV2::Listener",
                logicalId: this
                  .getLogicalId(listener.node.defaultChild as CfnListener)
              },
              testTrafficRoute: {
                type: "AWS::ElasticLoadBalancingV2::Listener",
                logicalId: this
                  .getLogicalId(listener.node.defaultChild as CfnListener)
              },
              targetGroups: [
                // @ts-ignore
                this.getLogicalId(blueTargetGroup),
                // @ts-ignore
                "TargetGroupGreen"
              ]
            }
          }
        }
      ]
    });

  }
}
