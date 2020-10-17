#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "@aws-cdk/core";
import { ServiceStack } from "../lib/stacks/service";

const app = new cdk.App();

const serviceStack = new ServiceStack(app, "EcsCicdServiceStack", {
  imageTag: app.node.tryGetContext("image-tag") ?? "latest"
});
