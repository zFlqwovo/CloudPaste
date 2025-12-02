/**
 * 任务编排工厂和类型导出
 * - 自动检测运行时环境 (Workers 或 Node.js)
 * - 统一类型导出
 */

import { WorkflowsTaskOrchestrator } from './WorkflowsTaskOrchestrator.js';
import { SQLiteTaskOrchestrator } from './SQLiteTaskOrchestrator.js';
import type { TaskOrchestratorAdapter } from './TaskOrchestratorAdapter.js';

// 类型导出
export type { TaskOrchestratorAdapter, JobStatus } from './TaskOrchestratorAdapter.js';
export type {
  CreateCopyJobParams,
  CopyJobDescriptor,
  JobFilter,
  TaskStats,
  TaskRecord,
  CopyTaskRecord,
  CopyTaskPayload,
  RetryPolicy,
} from './types.js';
export { TaskType, TaskStatus } from './types.js';

/** 运行时环境接口 */
export interface RuntimeEnv {
  // Workers 绑定
  JOB_WORKFLOW?: WorkflowNamespace;
  DB?: D1Database;
  // Node.js 配置
  TASK_DATABASE_PATH?: string;       // SQLite 路径 (unified-entry.js 自动设置)
  TASK_WORKER_POOL_SIZE?: number;   // Worker 池大小 (默认 10)
}

/**
 * 创建任务编排器 - 自动检测运行时
 * - Workers: WorkflowsTaskOrchestrator (Workflows API + D1)
 * - Node.js: SQLiteTaskOrchestrator (Worker Pool + SQLite)
 */
export function createTaskOrchestrator(
  fileSystem: any,
  env: RuntimeEnv
): TaskOrchestratorAdapter {
  console.log('[TaskOrchestrator] Runtime detection:', {
    hasJobWorkflow: !!env.JOB_WORKFLOW,
    hasDB: !!env.DB,
    hasTaskDatabasePath: !!env.TASK_DATABASE_PATH,
  });

  // Workers 环境检测
  if (env.JOB_WORKFLOW && env.DB) {
    console.log('[TaskOrchestrator] ✓ Using WorkflowsTaskOrchestrator (Workers)');
    return new WorkflowsTaskOrchestrator(
      env as { JOB_WORKFLOW: WorkflowNamespace; DB: D1Database },
      fileSystem
    );
  }

  // Node.js 环境
  console.log('[TaskOrchestrator] ✓ Using SQLiteTaskOrchestrator (Node.js)');
  if (!env.TASK_DATABASE_PATH) {
    console.warn('[TaskOrchestrator] WARNING: TASK_DATABASE_PATH not set, using fallback');
  }

  return new SQLiteTaskOrchestrator(
    fileSystem,
    env.TASK_DATABASE_PATH || './data/database.db',
    env.TASK_WORKER_POOL_SIZE || 10
  );
}

/** Workers Workflow 命名空间类型 */
interface WorkflowNamespace {
  create(params: { id: string; params: unknown }): Promise<any>;
  get(id: string): Promise<any>;
}
