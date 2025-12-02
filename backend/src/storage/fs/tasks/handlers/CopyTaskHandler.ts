// cSpell:words retryable
import type { TaskHandler, InternalJob, ExecutionContext } from '../TaskHandler.js';
import type { TaskStats, CopyTaskPayload, ItemResult, RetryPolicy } from '../types.js';
import { ValidationError } from '../../../../http/errors.js';
import {
  isRetryableError,
  calculateBackoffDelay,
  sleep,
  formatRetryLog,
  DEFAULT_RETRY_POLICY
} from '../utils/retryUtils.js';

/**
 * 复制任务处理器 - 支持同存储原子复制和跨存储流式复制
 * - 同存储: 驱动层原子复制 (S3 自动使用 CopyObject API)
 * - 跨存储: 后端流式复制 + 字节级进度监控
 */
export class CopyTaskHandler implements TaskHandler {
  readonly taskType = 'copy';

  /** 验证复制任务载荷 - items 非空数组且每项包含 sourcePath 和 targetPath */
  async validate(payload: any): Promise<void> {
    // 检查items字段存在且为数组
    if (!payload.items || !Array.isArray(payload.items)) {
      throw new ValidationError('items 必须是数组');
    }

    // 检查items非空
    if (payload.items.length === 0) {
      throw new ValidationError('items 不能为空');
    }

    // 验证每个item的结构
    for (let i = 0; i < payload.items.length; i++) {
      const item = payload.items[i];

      if (!item.sourcePath || typeof item.sourcePath !== 'string') {
        throw new ValidationError(
          `items[${i}].sourcePath 必须是非空字符串`
        );
      }

      if (!item.targetPath || typeof item.targetPath !== 'string') {
        throw new ValidationError(
          `items[${i}].targetPath 必须是非空字符串`
        );
      }
    }
  }

  /** 执行复制任务 - 预扫描文件大小 → 逐项复制 + 支持重试和取消 */
  async execute(job: InternalJob, context: ExecutionContext): Promise<void> {
    const payload = job.payload as CopyTaskPayload;
    const fileSystem = context.getFileSystem();

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let totalBytesTransferred = 0;  // 累计已传输字节

    // 初始化每个文件的状态跟踪数组
    const itemResults: ItemResult[] = payload.items.map(item => ({
      sourcePath: item.sourcePath,
      targetPath: item.targetPath,
      status: 'pending' as const,
    }));

    console.log(
      `[CopyTaskHandler] 开始执行作业 ${job.jobId}, 共 ${payload.items.length} 项`
    );

    // 预扫描所有源文件，获取 totalBytes
    let totalBytes = 0;
    const fileSizes: number[] = [];

    for (const item of payload.items) {
      try {
        if (item.sourcePath.endsWith('/')) {
          fileSizes.push(0);
          continue;
        }

        const fileInfo = await fileSystem.getFileInfo(
          item.sourcePath,
          job.userId,
          job.userType
        );
        const size = fileInfo?.size || 0;
        totalBytes += size;
        fileSizes.push(size);
      } catch (error) {
        fileSizes.push(0);
        console.warn(
          `[CopyTaskHandler] 无法获取文件大小: ${item.sourcePath}`,
          error
        );
      }
    }

    await context.updateProgress(job.jobId, { totalBytes, itemResults });

    console.log(
      `[CopyTaskHandler] 预扫描完成，总大小: ${totalBytes} 字节`
    );

    // 获取重试策略
    const retryPolicy: RetryPolicy = payload.options?.retryPolicy || DEFAULT_RETRY_POLICY;
    console.log(
      `[CopyTaskHandler] 重试策略: limit=${retryPolicy.limit}, delay=${retryPolicy.delay}ms, backoff=${retryPolicy.backoff}`
    );

    for (let i = 0; i < payload.items.length; i++) {
      const item = payload.items[i];

      // 检查取消状态
      if (await context.isCancelled(job.jobId)) {
        console.log(
          `[CopyTaskHandler] 作业 ${job.jobId} 已取消, 停止执行 (已处理 ${i}/${payload.items.length} 项)`
        );
        break;
      }

      // 单文件重试循环
      let lastError: Error | null = null;
      let fileSuccess = false;
      let fileSkipped = false;
      let currentFileBytes = 0;

      for (let attempt = 0; attempt <= retryPolicy.limit; attempt++) {
        if (attempt > 0) {
          const delay = calculateBackoffDelay(attempt, retryPolicy);

          console.log(
            `[CopyTaskHandler] ${formatRetryLog(
              attempt,
              retryPolicy.limit,
              delay,
              item.sourcePath,
              lastError?.message
            )}`
          );

          itemResults[i].status = 'retrying';
          itemResults[i].retryCount = attempt;
          itemResults[i].lastRetryAt = Date.now();
          await context.updateProgress(job.jobId, { itemResults });

          await sleep(delay);

          // 重试前再次检查取消
          if (await context.isCancelled(job.jobId)) {
            console.log(
              `[CopyTaskHandler] 作业 ${job.jobId} 在重试等待期间被取消`
            );
            break;
          }
        }

        itemResults[i].status = attempt > 0 ? 'retrying' : 'processing';
        currentFileBytes = 0;

        try{

          // 调用 FileSystem.copyItem() - 自动选择同存储原子复制或跨存储流式复制
          const copyResult = await fileSystem.copyItem(
            item.sourcePath,
            item.targetPath,
            job.userId,
            job.userType,
            {
              ...payload.options,
              onProgress: (bytesTransferred: number) => {
                currentFileBytes = bytesTransferred;
                itemResults[i].bytesTransferred = bytesTransferred;
                context.updateProgress(job.jobId, {
                  bytesTransferred: totalBytesTransferred + currentFileBytes,
                  itemResults,
                }).catch(() => {});
              },
            }
          );

          const isSkipped = copyResult?.status === 'skipped' || copyResult?.skipped === true;

          if (isSkipped) {
            fileSkipped = true;
          } else {
            const fileBytes = copyResult?.contentLength || currentFileBytes || 0;
            totalBytesTransferred += fileBytes;
            itemResults[i].bytesTransferred = fileBytes;
            fileSuccess = true;
          }

          itemResults[i].retryCount = attempt;
          break;

        } catch (error: any) {
          lastError = error;

          const canRetry = isRetryableError(error);
          const hasMoreRetries = attempt < retryPolicy.limit;

          if (!canRetry || !hasMoreRetries) {
            const retryInfo = attempt > 0 ? ` (已重试 ${attempt}/${retryPolicy.limit} 次)` : '';
            const retryableInfo = !canRetry ? ' [不可重试错误]' : '';

            itemResults[i].status = 'failed';
            itemResults[i].error = `${error.message || String(error)}${retryInfo}${retryableInfo}`;
            itemResults[i].retryCount = attempt;

            console.error(
              `[CopyTaskHandler] 复制最终失败 [${i + 1}/${payload.items.length}]${retryInfo}${retryableInfo} ` +
              `${item.sourcePath} → ${item.targetPath}: ${error.message || error}`
            );

            break;
          }

          console.warn(
            `[CopyTaskHandler] 复制失败 [${i + 1}/${payload.items.length}] (尝试 ${attempt + 1}/${retryPolicy.limit + 1}) ` +
            `${item.sourcePath}: ${error.message || error} [将重试]`
          );
        }
      }

      // 更新最终状态
      if (fileSkipped) {
        itemResults[i].status = 'skipped';
        itemResults[i].bytesTransferred = 0;
        skippedCount++;
      } else if (fileSuccess) {
        itemResults[i].status = 'success';
        successCount++;
        const retryCount = itemResults[i].retryCount;
        if (retryCount !== undefined && retryCount > 0) {
          console.log(
            `[CopyTaskHandler] ✓ 复制成功 (经 ${retryCount} 次重试) ${item.sourcePath}`
          );
        }
      } else {
        failedCount++;
      }

      // 更新进度
      await context.updateProgress(job.jobId, {
        processedItems: successCount + failedCount + skippedCount,
        successCount,
        failedCount,
        skippedCount,
        bytesTransferred: totalBytesTransferred,
        itemResults,
      });
    }

    console.log(
      `[CopyTaskHandler] 作业 ${job.jobId} 执行完成: ` +
        `成功 ${successCount}, 失败 ${failedCount}, 跳过 ${skippedCount}, ` +
        `传输 ${totalBytesTransferred} 字节`
    );
  }

  /** 创建统计模板 - 初始化所有项状态为 pending */
  createStatsTemplate(payload: any): TaskStats {
    const copyPayload = payload as CopyTaskPayload;

    const itemResults: ItemResult[] = copyPayload.items.map(item => ({
      sourcePath: item.sourcePath,
      targetPath: item.targetPath,
      status: 'pending' as const,
    }));

    return {
      totalItems: copyPayload.items.length,
      processedItems: 0,
      successCount: 0,
      failedCount: 0,
      skippedCount: 0,
      bytesTransferred: 0,
      itemResults,
    };
  }

}
