#!/usr/bin/env node
import "source-map-support/register";

import * as cdk from "@aws-cdk/core";
import { EcsCicdStack } from "../lib/ecs-cicd-stack";

const app = new cdk.App();

new EcsCicdStack(app, "EcsCicdStack");
