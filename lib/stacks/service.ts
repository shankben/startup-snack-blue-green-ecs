import {
  CfnOutput,
  Construct,
  Duration,
  Stack,
  StackProps
} from "@aws-cdk/core";

import {
  CfnCluster,
  CfnService,
  Cluster,
  DeploymentControllerType
} from "@aws-cdk/aws-ecs";

import {
  ApplicationListener,
  ApplicationLoadBalancer,
  ApplicationTargetGroup,
  ListenerAction,
  TargetType
} from "@aws-cdk/aws-elasticloadbalancingv2";

import {
  Peer,
  Port,
  SecurityGroup,
  Vpc
} from "@aws-cdk/aws-ec2";

import { LoadBalancerResources } from "../common/load-balancer-resources";
import FargateTaskBundle from "../constructs/fargate-task-bundle";
import CloudFormationBlueGreenHook from "../constructs/cfn-blue-green-hook";

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
      loadBalancerName: "StartupSnack-BlueGreenEcs",
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

  private makeFargateService(cluster: Cluster): CfnService {
    return new CfnService(this, "FargateService", {
      serviceName: "StartupSnack-BlueGreenEcsService",
      cluster: (cluster.node.defaultChild as CfnCluster).ref,
      desiredCount: 2,
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
      service,
      vpc,
      imageTag: props.imageTag,
      loadBalancerSecurityGroup: albResources.loadBalancerSecurityGroup,
      targetGroup: albResources.blueTargetGroup
    });

    new CloudFormationBlueGreenHook(this, "CloudFormationBlueGreenHook", {
      service,
      taskBundle,
      albResources
    });

    new CfnOutput(this, "LoadBalancerDnsName", {
      value: albResources.loadBalancer.loadBalancerDnsName
    });
  }
}
