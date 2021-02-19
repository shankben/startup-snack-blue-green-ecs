import {
  CfnCodeDeployBlueGreenHook,
  CfnOutput,
  CfnTrafficRoutingType,
  Construct,
  Duration,
  Stack,
  StackProps
} from "@aws-cdk/core";

import {
  CfnCluster,
  CfnService,
  CfnTaskDefinition,
  Cluster,
  DeploymentControllerType
} from "@aws-cdk/aws-ecs";

import {
  ApplicationListener,
  ApplicationLoadBalancer,
  ApplicationTargetGroup,
  CfnListener,
  CfnTargetGroup,
  ListenerAction,
  TargetType
} from "@aws-cdk/aws-elasticloadbalancingv2";

import {
  Peer,
  Port,
  SecurityGroup,
  Vpc
} from "@aws-cdk/aws-ec2";

import FargateTaskBundle from "../constructs/fargate-task-bundle";


interface LoadBalancerResources {
  loadBalancer: ApplicationLoadBalancer;
  listener: ApplicationListener;
  loadBalancerSecurityGroup: SecurityGroup;
  blueTargetGroup: ApplicationTargetGroup;
  greenTargetGroup: ApplicationTargetGroup;
}

interface ServiceStackProps extends StackProps {
  imageTag: string;
}

export class ServiceStack extends Stack {
  private makeLoadBalancerResources(vpc: Vpc): LoadBalancerResources {
    const securityGroup = new SecurityGroup(this, "AlbSg", {
      vpc,
      allowAllOutbound: true,
    });
    securityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(80));

    const loadBalancer = new ApplicationLoadBalancer(this, "Alb", {
      vpc,
      loadBalancerName: "StartupSnack-BlueGreenEcsLoadBalancer",
      internetFacing: true,
      securityGroup
    });

    const [blueTargetGroup, greenTargetGroup] = ["blue", "green"]
      .map((color) => new ApplicationTargetGroup(this, `TargetGroup${color}`, {
        vpc,
        targetType: TargetType.IP,
        deregistrationDelay: Duration.seconds(0),
        port: 80,
        healthCheck: {
          interval: Duration.seconds(5),
          timeout: Duration.seconds(2),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 4
        }
      }));

    const listener = new ApplicationListener(this, "PublicListener", {
      loadBalancer,
      port: 80,
      defaultAction: ListenerAction.weightedForward([{
        targetGroup: blueTargetGroup,
        weight: 1
      }])
    });

    return {
      blueTargetGroup,
      greenTargetGroup,
      listener,
      loadBalancer,
      loadBalancerSecurityGroup: securityGroup
    };
  }

  private makeCodeDeployBlueGreenHook(
    service: CfnService,
    taskBundle: FargateTaskBundle,
    albResources: LoadBalancerResources
  ) {
    this.addTransform("AWS::CodeDeployBlueGreen");
    new CfnCodeDeployBlueGreenHook(this, "BlueGreenHook", {
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
              this.getLogicalId(taskBundle.taskDefinition.node
                .defaultChild as CfnTaskDefinition),
              "TaskDefGreen"
            ],
            taskSets: [
              this.getLogicalId(taskBundle.taskSet),
              "TaskSetGreen"
            ],
            trafficRouting: {
              prodTrafficRoute: {
                type: "AWS::ElasticLoadBalancingV2::Listener",
                logicalId: this
                  .getLogicalId(albResources.listener.node
                    .defaultChild as CfnListener)
              },
              testTrafficRoute: {
                type: "AWS::ElasticLoadBalancingV2::Listener",
                logicalId: this
                  .getLogicalId(albResources.listener.node
                    .defaultChild as CfnListener)
              },
              targetGroups: [
                this.getLogicalId(albResources.blueTargetGroup.node
                  .defaultChild as CfnTargetGroup),
                this.getLogicalId(albResources.greenTargetGroup.node
                  .defaultChild as CfnTargetGroup)
              ]
            }
          }
        }
      ]
    });
  }

  private makeFargateService(cluster: Cluster): CfnService {
    return new CfnService(this, "FargateService", {
      serviceName: "StartupSnack-BlueGreenEcsService",
      cluster: (cluster.node.defaultChild as CfnCluster).ref,
      desiredCount: 4,
      schedulingStrategy: "REPLICA",
      deploymentConfiguration: {
        maximumPercent: 150,
        minimumHealthyPercent: 50
      },
      deploymentController: {
        type: DeploymentControllerType.EXTERNAL
      }
    });
  }

  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);

    const vpc = new Vpc(this, "Vpc", { maxAzs: 2 });
    const cluster = new Cluster(this, "StartupSnack-BlueGreenEcsCluster", {
      vpc,
      clusterName: "StartupSnack-BlueGreenEcsCluster"
    });
    const service = this.makeFargateService(cluster);
    const albResources = this.makeLoadBalancerResources(vpc);
    const taskBundle = new FargateTaskBundle(this, "FargateTaskBundle", {
      cluster,
      imageTag: props.imageTag,
      loadBalancerSecurityGroup: albResources.loadBalancerSecurityGroup,
      service,
      targetGroup: albResources.blueTargetGroup,
      vpc
    });
    this.makeCodeDeployBlueGreenHook(service, taskBundle, albResources);
    new CfnOutput(this, "LoadBalancerDnsName", {
      value: albResources.loadBalancer.loadBalancerDnsName
    });
  }
}
