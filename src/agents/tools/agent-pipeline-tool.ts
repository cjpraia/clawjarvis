/**
 * Agent Pipeline Tool - Integrates Planner + Evaluator + Reflexion
 *
 * This tool provides a robust pipeline for complex tasks:
 * - Planner: decomposes task into steps
 * - Evaluator: evaluates the result
 * - Reflexion: learns from errors
 *
 * This is CODE integration, not prompt-based.
 */

import { Type } from "@sinclair/typebox";
import { createEvaluator } from "../evaluator.js";
import { createPlanner } from "../planner.js";
import { createReflexionAgent } from "../reflexion.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult } from "./common.js";

// Pipeline configuration
const PIPELINE_CONFIG = {
  maxSteps: 10,
  maxIterations: 3,
  qualityThreshold: 80,
};

const AgentPipelineToolSchema = Type.Object({
  action: Type.Union([
    Type.Literal("plan"),
    Type.Literal("evaluate"),
    Type.Literal("execute"),
    Type.Literal("full"),
  ]),
  task: Type.String(),
  currentStep: Type.Optional(Type.Number()),
  previousResult: Type.Optional(Type.String()),
});

export function createAgentPipelineTool(): AnyAgentTool {
  const planner = createPlanner({ maxSteps: PIPELINE_CONFIG.maxSteps });
  const evaluator = createEvaluator({
    maxIterations: PIPELINE_CONFIG.maxIterations,
    qualityThreshold: PIPELINE_CONFIG.qualityThreshold,
  });
  const reflexion = createReflexionAgent();

  return {
    name: "agent_pipeline",
    description:
      "Pipeline for complex tasks: plan, execute, evaluate, and learn from errors. Use for multi-step tasks.",
    schema: AgentPipelineToolSchema,
    execute: async (params: typeof AgentPipelineToolSchema._type, _ctx) => {
      const { action, task, currentStep, previousResult } = params;

      switch (action) {
        case "plan": {
          // Create a plan for the task
          const plan = await planner.createPlan(task);
          return jsonResult({
            status: "success",
            action: "plan",
            plan: {
              task: plan.task,
              steps: plan.steps.map((s) => ({
                id: s.id,
                description: s.description,
                status: s.status,
              })),
              totalSteps: plan.steps.length,
              progress: planner.getProgress(),
            },
            format: plan.formatForDisplay(),
          });
        }

        case "evaluate": {
          // Evaluate a result
          const result = await evaluator.evaluate(task, previousResult || "");
          return jsonResult({
            status: "success",
            action: "evaluate",
            evaluation: {
              score: result.score,
              quality: result.quality,
              isComplete: result.isComplete,
              issues: result.issues.map((i) => ({
                type: i.type,
                description: i.description,
                severity: i.severity,
              })),
            },
            format: evaluator.formatEvaluation(task, result),
          });
        }

        case "execute": {
          // Execute a specific step
          if (!currentStep) {
            return jsonResult({
              status: "error",
              error: "currentStep is required for execute action",
            });
          }

          const step = planner.startStep(currentStep);
          if (!step) {
            return jsonResult({
              status: "error",
              error: `Step ${currentStep} not found or already completed`,
            });
          }

          return jsonResult({
            status: "success",
            action: "execute",
            step: {
              id: step.id,
              description: step.description,
              status: step.status,
            },
            instruction: `Execute step ${step.id}: ${step.description}`,
          });
        }

        case "full": {
          // Full pipeline: plan -> evaluate -> reflexion if needed
          const plan = await planner.createPlan(task);

          // Execute all steps
          let lastResult = "";
          for (const step of plan.steps) {
            planner.startStep(step.id);
            // Mark as completed (in real implementation, would execute)
            planner.completeStep(step.id, "Step executed");
            lastResult = `Executed: ${step.description}`;
          }

          // Evaluate the result
          const evaluation = await evaluator.evaluate(task, lastResult);

          // If failed, save to reflexion
          if (evaluation.quality === "failed") {
            await reflexion.processFailure(task, "Task failed", evaluation, null);
          }

          return jsonResult({
            status: "success",
            action: "full",
            pipeline: {
              plan: plan.steps.length,
              evaluation: {
                score: evaluation.score,
                quality: evaluation.quality,
              },
              learned: evaluation.quality === "failed",
            },
          });
        }

        default:
          return jsonResult({
            status: "error",
            error: `Unknown action: ${action}`,
          });
      }
    },
  };
}
