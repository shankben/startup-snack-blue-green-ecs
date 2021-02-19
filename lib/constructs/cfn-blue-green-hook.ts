import {
  CfnCodeDeployBlueGreenHook,
  CfnTrafficRoutingType,
  Construct,
  Stack
} from "@aws-cdk/core";

import {
  CfnListener,
  CfnTargetGroup,
} from "@aws-cdk/aws-elasticloadbalancingv2";

import { CfnService, CfnTaskDefinition } from "@aws-cdk/aws-ecs";

import { LoadBalancerResources } from "../common/load-balancer-resources";
import type FargateTaskBundle from "./fargate-task-bundle";

interface CloudFormationBlueGreenHookProps {
  service: CfnService,
  taskBundle: FargateTaskBundle,
  albResources: LoadBalancerResources
}

export default class CloudFormationBlueGreenHook extends Construct {
  constructor(
    scope: Stack,
    id: string,
    props: CloudFormationBlueGreenHookProps
  ) {
    super(scope, id);

    scope.addTransform("AWS::CodeDeployBlueGreen");
    new CfnCodeDeployBlueGreenHook(this, "BlueGreenHook", {
      serviceRole: "AWSCodeDeployRoleForECS",
      trafficRoutingConfig: {
        type: CfnTrafficRoutingType.ALL_AT_ONCE
      },
      applications: [
        {
          target: {
            type: "AWS::ECS::Service",
            logicalId: scope.getLogicalId(props.service)
          },
          ecsAttributes: {
            taskDefinitions: [
              scope.getLogicalId(props.taskBundle.taskDefinition.node
                .defaultChild as CfnTaskDefinition),
              "TaskDefGreen"
            ],
            taskSets: [
              scope.getLogicalId(props.taskBundle.taskSet),
              "TaskSetGreen"
            ],
            trafficRouting: {
              prodTrafficRoute: {
                type: "AWS::ElasticLoadBalancingV2::Listener",
                logicalId: scope
                  .getLogicalId(props.albResources.listener.node
                    .defaultChild as CfnListener)
              },
              testTrafficRoute: {
                type: "AWS::ElasticLoadBalancingV2::Listener",
                logicalId: scope
                  .getLogicalId(props.albResources.listener.node
                    .defaultChild as CfnListener)
              },
              targetGroups: [
                scope.getLogicalId(props.albResources.blueTargetGroup.node
                  .defaultChild as CfnTargetGroup),
                scope.getLogicalId(props.albResources.greenTargetGroup.node
                  .defaultChild as CfnTargetGroup)
              ]
            }
          }
        }
      ]
    });
  }
}
