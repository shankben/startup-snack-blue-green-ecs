import {
  CfnCodeDeployBlueGreenHook,
  CfnOutput,
  CfnTrafficRoutingType,
  Construct,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps
} from "@aws-cdk/core";

import {
  AwsLogDriver,
  CfnCluster,
  CfnPrimaryTaskSet,
  CfnService,
  CfnTaskDefinition,
  CfnTaskSet,
  Cluster,
  ContainerDefinition,
  ContainerImage,
  DeploymentControllerType,
  FargateTaskDefinition,
  LaunchType,
  RepositoryImage
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
  LogGroup,
  RetentionDays
} from "@aws-cdk/aws-logs";

import {
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc
} from "@aws-cdk/aws-ec2";


interface ServiceStackProps extends StackProps {
  imageTag: string;
}

export class ServiceStack extends Stack {
  private readonly transform = true;
  private readonly image: RepositoryImage;

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
      image: this.image,
      logging: new AwsLogDriver({
        streamPrefix: `nginx-${color}`,
        logGroup: new LogGroup(this, `ContainerLogGroup${color}`, {
          logGroupName: "/aws/ecs/nginx",
          retention: RetentionDays.ONE_DAY,
          removalPolicy: RemovalPolicy.DESTROY
        })
      })
    });
    container.addPortMappings({
      containerPort: 80
    });
    return { task, container };
  }

  private makeTargetGroup(color: string, vpc: Vpc): ApplicationTargetGroup {
    return new ApplicationTargetGroup(this, `TargetGroup${color}`, {
      vpc,
      targetGroupName: `nginx-${color}`,
      targetType: TargetType.IP,
      deregistrationDelay: Duration.seconds(0),
      port: 80,
      healthCheck: {
        interval: Duration.seconds(5),
        timeout: Duration.seconds(2),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 4
      }
    });
  }

  constructor(scope: Construct, id: string, props: ServiceStackProps) {
    super(scope, id, props);

    this.image = ContainerImage.fromRegistry(
      `nginxdemos/hello:${props.imageTag}`
    );

    const vpc = new Vpc(this, "Vpc", { maxAzs: 3 });

    const loadBalancerSecurityGroup = new SecurityGroup(this, "AlbSg", {
      vpc,
      allowAllOutbound: true,
    });
    loadBalancerSecurityGroup.addIngressRule(Peer.anyIpv4(), Port.tcp(80));

    const loadBalancer = new ApplicationLoadBalancer(this, "ALB", {
      vpc,
      internetFacing: true,
      securityGroup: loadBalancerSecurityGroup
    });

    new CfnOutput(this, "LoadBalancerDnsName", {
      value: loadBalancer.loadBalancerDnsName
    });

    const cluster = new Cluster(this, "EcsCluster", { vpc });

    const service = new CfnService(this, "FargateService", {
      cluster: (cluster.node.defaultChild as CfnCluster).ref,
      desiredCount: 1,
      deploymentController: {
        type: DeploymentControllerType.EXTERNAL
      }
    });

    const [blueTargetGroup, greenTargetGroup] = ["blue", "green"]
      .map((it) => this.makeTargetGroup(it, vpc));
    
    const listener = new ApplicationListener(this, "PublicListener", {
      loadBalancer,
      port: 80,
      defaultAction: ListenerAction.weightedForward([{
        targetGroup: blueTargetGroup,
        weight: 1
      }])
    });

    const blueTask = this.makeTask("blue");

    const blueTaskSet = new CfnTaskSet(this, "TaskSetBlue", {
      cluster: (cluster.node.defaultChild as CfnCluster).ref,
      service: service.ref,
      launchType: LaunchType.FARGATE,
      platformVersion:  "1.3.0",
      taskDefinition: blueTask.task.taskDefinitionArn,
      scale: {
        unit: "PERCENT",
        value: 1
      },
      networkConfiguration: {
        awsVpcConfiguration: {
          securityGroups: [loadBalancerSecurityGroup.securityGroupId],
          subnets: vpc.selectSubnets({
            subnetType: SubnetType.PRIVATE
          }).subnetIds
        }
      },
      loadBalancers: [{
        containerName: blueTask.container.containerName,
        containerPort: blueTask.container.containerPort,
        targetGroupArn: blueTargetGroup.targetGroupArn
      }]
    });

    new CfnPrimaryTaskSet(this, "PrimaryTaskSet", {
      cluster: (cluster.node.defaultChild as CfnCluster).ref,
      service: service.ref,
      taskSetId: blueTaskSet.attrId
    });

    if (this.transform) {
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
                this.getLogicalId(blueTask.task.node
                  .defaultChild as CfnTaskDefinition),
                "TaskDefGreen"
              ],
              taskSets: [
                this.getLogicalId(blueTaskSet),
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
                  this.getLogicalId(blueTargetGroup
                    .node.defaultChild as CfnTargetGroup),
                  this.getLogicalId(greenTargetGroup
                    .node.defaultChild as CfnTargetGroup)
                ]
              }
            }
          }
        ]
      });
    }

  }
}
