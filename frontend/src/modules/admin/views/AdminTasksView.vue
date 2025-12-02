<template>
  <div class="p-3 sm:p-4 md:p-5 lg:p-6 flex-1 flex flex-col overflow-y-auto">
    <!-- 顶部操作栏 -->
    <div class="flex flex-col space-y-3 mb-4">
      <!-- 标题和操作按钮行 -->
      <div class="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">
        <div>
          <h2 class="text-lg sm:text-xl font-medium" :class="isDarkMode ? 'text-white' : 'text-gray-900'">
            {{ $t('admin.tasks.title') }}
          </h2>
          <p class="mt-1 text-xs sm:text-sm" :class="isDarkMode ? 'text-gray-400' : 'text-gray-500'">
            {{ $t('admin.tasks.description') }}
          </p>
        </div>

        <!-- 操作按钮组 -->
        <div class="flex gap-2">
          <!-- 刷新按钮 -->
          <button
            @click="loadTasks"
            :disabled="isLoading"
            class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-sm font-medium rounded-md shadow-sm transition-all duration-200 ease-in-out"
            :class="isDarkMode ? 'bg-blue-600 hover:bg-blue-700 text-white' : 'bg-blue-500 hover:bg-blue-600 text-white'"
          >
            <svg
              v-if="!isLoading"
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4 mr-1.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
            <svg v-else class="animate-spin h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span class="hidden xs:inline">{{ $t('admin.tasks.actions.refresh') }}</span>
          </button>

          <!-- 展开/收起全部按钮 -->
          <button
            v-if="paginatedTasks.length > 0"
            @click="toggleExpandAll"
            class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border text-sm font-medium rounded-md shadow-sm transition-all duration-200 ease-in-out"
            :class="isDarkMode ? 'border-gray-600 bg-gray-700 hover:bg-gray-600 text-gray-200' : 'border-gray-300 bg-white hover:bg-gray-50 text-gray-700'"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              class="h-4 w-4 mr-1.5 transition-transform duration-200"
              :class="{ 'rotate-180': isAllExpanded }"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
            </svg>
            <span class="hidden xs:inline">{{ isAllExpanded ? $t('admin.tasks.actions.collapseAll') : $t('admin.tasks.actions.expandAll') }}</span>
          </button>

          <!-- 批量删除按钮 -->
          <button
            v-if="hasTaskPermission"
            @click="deleteSelectedTasks"
            :disabled="selectedTasks.length === 0"
            class="inline-flex items-center px-2 py-1 sm:px-3 sm:py-1.5 md:px-4 md:py-2 border border-transparent text-sm font-medium rounded-md shadow-sm transition-all duration-200 ease-in-out"
            :class="[
              selectedTasks.length === 0
                ? 'opacity-50 cursor-not-allowed bg-gray-400 dark:bg-gray-600'
                : isDarkMode
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-red-500 hover:bg-red-600 text-white',
            ]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span class="hidden xs:inline">{{ $t('admin.tasks.actions.delete') }}{{ selectedTasks.length ? ` (${selectedTasks.length})` : '' }}</span>
            <span class="xs:hidden">{{ $t('admin.tasks.actions.deleteShort') }}{{ selectedTasks.length ? ` (${selectedTasks.length})` : '' }}</span>
          </button>
        </div>
      </div>
    </div>

    <!-- 筛选栏 -->
    <div class="bg-white dark:bg-gray-800 shadow-md rounded-lg p-4 mb-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <!-- 搜索框 -->
        <div class="sm:col-span-2 lg:col-span-1">
          <input
            v-model="filters.search"
            type="text"
            :placeholder="$t('admin.tasks.filters.searchPlaceholder')"
            class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          />
        </div>

        <!-- 状态筛选 -->
        <div>
          <select
            v-model="filters.status"
            class="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-1 focus:ring-primary-500 focus:border-primary-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
          >
            <option value="">{{ $t('admin.tasks.filters.allStatuses') }}</option>
            <option value="pending">{{ $t('admin.tasks.status.pending') }}</option>
            <option value="running">{{ $t('admin.tasks.status.running') }}</option>
            <option value="completed">{{ $t('admin.tasks.status.completed') }}</option>
            <option value="partial">{{ $t('admin.tasks.status.partial') }}</option>
            <option value="failed">{{ $t('admin.tasks.status.failed') }}</option>
            <option value="cancelled">{{ $t('admin.tasks.status.cancelled') }}</option>
          </select>
        </div>
      </div>
    </div>

    <!-- 表格容器 -->
    <div class="overflow-hidden bg-white dark:bg-gray-800 shadow-md rounded-lg">
      <!-- 加载状态 -->
      <div v-if="isLoading && tasks.length === 0" class="text-center py-12">
        <svg class="animate-spin h-10 w-10 mx-auto text-primary-600" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <p class="mt-3 text-sm" :class="isDarkMode ? 'text-gray-400' : 'text-gray-600'">{{ $t('admin.tasks.loading') }}</p>
      </div>

      <!-- 错误状态 -->
      <div v-else-if="loadError" class="p-4">
        <div class="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md p-3">
          <p class="text-sm text-red-800 dark:text-red-200">{{ loadError }}</p>
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else-if="filteredTasks.length === 0" class="text-center py-12">
        <svg class="mx-auto h-10 w-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
        <h3 class="mt-2 text-sm font-medium" :class="isDarkMode ? 'text-white' : 'text-gray-900'">{{ $t('admin.tasks.empty.title') }}</h3>
        <p class="mt-1 text-sm" :class="isDarkMode ? 'text-gray-400' : 'text-gray-500'">{{ $t('admin.tasks.empty.description') }}</p>
      </div>

      <!-- 任务表格 -->
      <div v-else class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead class="bg-gray-50 dark:bg-gray-700/50">
            <tr>
              <!-- 全选复选框 -->
              <th scope="col" class="w-12 px-4 py-3 text-left">
                <input
                  type="checkbox"
                  :checked="isAllSelected"
                  @change="toggleSelectAll"
                  class="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 dark:border-gray-600 rounded cursor-pointer"
                />
              </th>

              <!-- 任务名称 -->
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" :class="isDarkMode ? 'text-gray-300' : 'text-gray-700'">
                {{ $t('admin.tasks.table.name') }}
              </th>

              <!-- 状态 -->
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" :class="isDarkMode ? 'text-gray-300' : 'text-gray-700'">
                {{ $t('admin.tasks.table.status') }}
              </th>

              <!-- 进度与统计 -->
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" :class="isDarkMode ? 'text-gray-300' : 'text-gray-700'">
                {{ $t('admin.tasks.table.progress') }}
              </th>

              <!-- 创建者 -->
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" :class="isDarkMode ? 'text-gray-300' : 'text-gray-700'">
                {{ $t('admin.tasks.table.creator') }}
              </th>

              <!-- 创建时间 -->
              <th scope="col" class="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider" :class="isDarkMode ? 'text-gray-300' : 'text-gray-700'">
                {{ $t('admin.tasks.time.created') }}
              </th>

              <!-- 操作 -->
              <th scope="col" class="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider" :class="isDarkMode ? 'text-gray-300' : 'text-gray-700'">
                {{ $t('admin.tasks.table.actions') }}
              </th>
            </tr>
          </thead>
          <tbody v-for="task in paginatedTasks" :key="task.id" class="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
              <!-- 主行 -->
              <tr class="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                <!-- 复选框 -->
                <td class="px-4 py-3 whitespace-nowrap">
                  <input
                    type="checkbox"
                    :checked="selectedTasks.includes(task.id)"
                    @change="toggleTaskSelection(task.id)"
                    class="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 dark:border-gray-600 rounded cursor-pointer"
                  />
                </td>

                <!-- 任务名称 (带截断) -->
                <td class="px-4 py-3">
                  <div class="flex items-center space-x-2">
                    <div class="flex-shrink-0">
                      <div class="w-8 h-8 rounded bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                        <svg class="w-4 h-4 text-primary-600 dark:text-primary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </div>
                    </div>
                    <div class="min-w-0 flex-1">
                      <div class="text-sm font-medium max-w-[200px] truncate" :class="isDarkMode ? 'text-white' : 'text-gray-900'" :title="task.name">
                        {{ task.name }}
                      </div>
                      <div class="text-xs font-mono max-w-[200px] truncate" :class="isDarkMode ? 'text-gray-400' : 'text-gray-500'" :title="task.id">
                        {{ task.id }}
                      </div>
                    </div>
                  </div>
                </td>

                <!-- 状态 -->
                <td class="px-4 py-3 whitespace-nowrap">
                  <span
                    :class="[
                      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
                      getStatusColor(task.status),
                    ]"
                  >
                    <span
                      v-if="task.status === 'running'"
                      class="w-1.5 h-1.5 mr-1.5 rounded-full bg-current animate-pulse"
                    ></span>
                    {{ $t(`admin.tasks.status.${task.status}`) }}
                  </span>
                </td>

                <!-- 进度与统计 (分段式进度条) -->
                <td class="px-4 py-3 whitespace-nowrap">
                  <div class="w-32">
                    <!-- 进度条行：分段进度条 + 百分比 -->
                    <div class="flex items-center gap-2">
                      <!-- 分段式进度条 -->
                      <div class="flex-1 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden flex">
                        <!-- 成功段 (绿色) -->
                        <div
                          v-if="task.stats.success > 0"
                          class="h-full bg-green-500 transition-all duration-300"
                          :style="{ width: `${(task.stats.success / task.stats.total) * 100}%` }"
                        ></div>
                        <!-- 跳过段 (黄色) -->
                        <div
                          v-if="task.stats.skipped > 0"
                          class="h-full bg-yellow-500 transition-all duration-300"
                          :style="{ width: `${(task.stats.skipped / task.stats.total) * 100}%` }"
                        ></div>
                        <!-- 失败段 (红色) -->
                        <div
                          v-if="task.stats.failed > 0"
                          class="h-full bg-red-500 transition-all duration-300"
                          :style="{ width: `${(task.stats.failed / task.stats.total) * 100}%` }"
                        ></div>
                        <!-- 进行中段 (蓝色脉冲) -->
                        <div
                          v-if="task.status === 'running' && (task.stats.total - task.stats.success - task.stats.skipped - task.stats.failed) > 0"
                          class="h-full bg-blue-500 animate-pulse transition-all duration-300"
                          :style="{ width: `${(1 / task.stats.total) * 100}%` }"
                        ></div>
                      </div>
                      <!-- 百分比 -->
                      <span class="text-xs font-medium min-w-[2.5rem] text-right" :class="isDarkMode ? 'text-gray-300' : 'text-gray-700'">
                        {{ task.progress }}%
                      </span>
                    </div>
                    <!-- 统计数字 (小字) -->
                    <div class="text-xs mt-1" :class="isDarkMode ? 'text-gray-400' : 'text-gray-500'">
                      {{ task.stats.success + task.stats.skipped + task.stats.failed }}/{{ task.stats.total }}
                    </div>
                  </div>
                </td>

                <!-- 创建者 -->
                <td class="px-4 py-3 whitespace-nowrap">
                  <span
                    :class="[
                      'px-2 py-1 text-xs rounded inline-block',
                      getCreatorBadgeClass(task.userId)
                    ]"
                  >
                    {{ getCreatorText(task.userId, task.keyName) }}
                  </span>
                </td>

                <!-- 创建时间 -->
                <td class="px-4 py-3 whitespace-nowrap text-xs" :class="isDarkMode ? 'text-gray-400' : 'text-gray-500'">
                  {{ task.relativeTime }}
                </td>

                <!-- 操作 -->
                <td class="px-4 py-3 whitespace-nowrap text-right">
                  <div class="flex justify-end items-center gap-2">
                    <!-- 取消按钮 - 仅对运行中或等待中的任务显示 -->
                    <button
                      v-if="hasTaskPermission && (task.status === 'running' || task.status === 'pending')"
                      @click="cancelTask(task.id)"
                      class="p-1.5 sm:p-2 rounded-full transition-colors text-orange-600 hover:text-orange-900 dark:text-orange-400 dark:hover:text-orange-300 hover:bg-orange-50 dark:hover:bg-orange-900/20"
                      :title="$t('admin.tasks.actions.cancel')"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 sm:h-5 sm:w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>

                    <!-- 展开按钮 -->
                    <button
                      @click="toggleExpandRow(task.id)"
                      class="p-1.5 rounded-full transition-colors"
                      :class="isDarkMode ? 'hover:bg-gray-700 text-gray-400 hover:text-gray-200' : 'hover:bg-gray-100 text-gray-500 hover:text-gray-700'"
                      :title="expandedRows.includes(task.id) ? '收起' : '展开'"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        class="h-5 w-5 transition-transform duration-200"
                        :class="{ 'rotate-180': expandedRows.includes(task.id) }"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>

                    <!-- 删除按钮 -->
                    <button
                      v-if="hasTaskPermission"
                      @click="deleteSingleTask(task.id)"
                      class="p-1.5 sm:p-2 rounded-full transition-colors text-red-600 hover:text-red-900 dark:text-red-400 dark:hover:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20"
                      :title="$t('admin.tasks.actions.delete')"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 sm:h-5 sm:w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>

              <!-- 展开行 -->
              <tr v-if="expandedRows.includes(task.id)" class="bg-gray-50 dark:bg-gray-900/50">
                <td colspan="7" class="px-4 py-4">
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <!-- 文件列表 (多文件时显示每个文件状态) -->
                    <div v-if="task.itemResults && task.itemResults.length > 0" class="md:col-span-2">
                      <div class="flex items-center justify-between mb-2">
                        <div class="font-medium" :class="isDarkMode ? 'text-gray-300' : 'text-gray-700'">
                          {{ $t('admin.tasks.details.fileList') }} ({{ task.itemResults.length }})
                        </div>
                        <!-- 重试所有失败文件按钮 -->
                        <button
                          v-if="hasTaskPermission && task.stats.failed > 0 && (task.status === 'completed' || task.status === 'partial' || task.status === 'failed')"
                          @click="retryAllFailedFiles(task.id)"
                          class="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors"
                          :class="isDarkMode ? 'bg-orange-600 hover:bg-orange-700 text-white' : 'bg-orange-500 hover:bg-orange-600 text-white'"
                        >
                          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          {{ $t('admin.tasks.actions.retryAllFailed') }} ({{ task.stats.failed }})
                        </button>
                      </div>
                      <!-- 文件列表容器 - 简洁列表样式 -->
                      <div class="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                        <div
                          v-for="(item, index) in task.itemResults"
                          :key="index"
                          class="relative rounded-lg overflow-hidden transition-all duration-200"
                          :class="isDarkMode ? 'bg-gray-800' : 'bg-white border border-gray-200'"
                        >
                          <!-- 背景进度条 - 从左到右渐变填充 -->
                          <div
                            class="absolute inset-0 transition-all duration-500 ease-out"
                            :class="getFileProgressBgClass(item.status)"
                            :style="{ width: getFileProgressWidth(item) }"
                          ></div>

                          <!-- 文件信息内容层 -->
                          <div class="relative flex items-center gap-3 px-3 py-2.5 text-xs">
                            <!-- 状态图标 - 圆形背景 + SVG -->
                            <span class="flex-shrink-0">
                              <!-- 成功 -->
                              <span v-if="item.status === 'success'" class="w-5 h-5 rounded-full bg-green-500 flex items-center justify-center shadow-sm">
                                <svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" />
                                </svg>
                              </span>
                              <!-- 处理中 -->
                              <span v-else-if="item.status === 'processing'" class="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center shadow-sm">
                                <svg class="w-3 h-3 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                </svg>
                              </span>
                              <!-- 重试中 -->
                              <span v-else-if="item.status === 'retrying'" class="w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center shadow-sm animate-pulse">
                                <svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                              </span>
                              <!-- 失败 -->
                              <span v-else-if="item.status === 'failed'" class="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center shadow-sm">
                                <svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </span>
                              <!-- 跳过 -->
                              <span v-else-if="item.status === 'skipped'" class="w-5 h-5 rounded-full bg-yellow-500 flex items-center justify-center shadow-sm">
                                <svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M20 12H4" />
                                </svg>
                              </span>
                              <!-- 等待中 -->
                              <span v-else class="w-5 h-5 rounded-full border-2 flex items-center justify-center" :class="isDarkMode ? 'border-gray-500 bg-gray-700' : 'border-gray-300 bg-gray-100'">
                                <span class="w-1.5 h-1.5 rounded-full" :class="isDarkMode ? 'bg-gray-500' : 'bg-gray-400'"></span>
                              </span>
                            </span>

                            <!-- 文件名 + 重试次数 -->
                            <span class="flex-shrink-0 max-w-[200px] flex items-center gap-1">
                              <span
                                class="truncate font-medium"
                                :class="isDarkMode ? 'text-gray-100' : 'text-gray-800'"
                                :title="item.sourcePath"
                              >
                                {{ extractNameFromPath(item.sourcePath) }}
                              </span>
                              <!-- 重试次数标记 -->
                              <span
                                v-if="item.retryCount && item.retryCount > 0"
                                class="flex-shrink-0 text-orange-500"
                                :title="$t('admin.tasks.retry.retryCount', { count: item.retryCount })"
                              >
                                {{ $t('admin.tasks.retry.withRetry', { count: item.retryCount }) }}
                              </span>
                            </span>

                            <!-- 箭头 + 目标路径 -->
                            <span class="flex-1 min-w-0 flex items-center gap-1 text-gray-500 dark:text-gray-400">
                              <svg class="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3" />
                              </svg>
                              <span class="truncate font-mono text-xs" :title="item.targetPath">
                                {{ item.targetPath || '...' }}
                              </span>
                            </span>

                            <!-- 文件大小 -->
                            <span class="flex-shrink-0 w-20 text-right font-mono" :class="isDarkMode ? 'text-gray-400' : 'text-gray-500'">
                              {{ item.bytesTransferred ? formatFileSize(item.bytesTransferred) : '--' }}
                            </span>

                            <!-- 状态徽章 -->
                            <span
                              class="flex-shrink-0 px-2 py-0.5 rounded-full text-xs font-medium"
                              :class="getFileStatusBadgeClass(item.status)"
                            >
                              {{ getFileStatusText(item.status) }}
                            </span>

                            <!-- 单文件重试按钮 -->
                            <button
                              v-if="hasTaskPermission && item.status === 'failed' && (task.status === 'completed' || task.status === 'partial' || task.status === 'failed')"
                              @click.stop="retryFailedFile(task, item)"
                              class="flex-shrink-0 p-1 rounded-full transition-colors opacity-0 group-hover:opacity-100"
                              :class="isDarkMode ? 'hover:bg-gray-700 text-orange-400 hover:text-orange-300' : 'hover:bg-orange-50 text-orange-500 hover:text-orange-600'"
                              :title="$t('admin.tasks.actions.retryFile')"
                            >
                              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                            </button>
                          </div>

                          <!-- 错误信息 (失败时内嵌显示) -->
                          <div
                            v-if="item.status === 'failed' && item.error"
                            class="relative px-3 pb-2 pt-0"
                          >
                            <div
                              class="flex items-start gap-1.5 px-2 py-1.5 rounded text-xs"
                              :class="isDarkMode ? 'bg-red-900/30 text-red-300' : 'bg-red-50 text-red-600'"
                            >
                              <svg class="w-3.5 h-3.5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                              <span>{{ item.error }}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <!-- 单文件时显示路径信息 (兼容旧数据) -->
                    <template v-else>
                      <!-- 源路径 -->
                      <div>
                        <div class="font-medium mb-1" :class="isDarkMode ? 'text-gray-300' : 'text-gray-700'">
                          {{ $t('admin.tasks.details.sourcePath') }}
                        </div>
                        <div class="font-mono text-xs p-2 rounded break-all" :class="isDarkMode ? 'bg-gray-800 text-gray-400' : 'bg-white text-gray-600 border border-gray-200'">
                          {{ task.details.sourcePath || $t('admin.tasks.details.none') }}
                        </div>
                      </div>

                      <!-- 目标路径 -->
                      <div>
                        <div class="font-medium mb-1" :class="isDarkMode ? 'text-gray-300' : 'text-gray-700'">
                          {{ $t('admin.tasks.details.targetPath') }}
                        </div>
                        <div class="font-mono text-xs p-2 rounded break-all" :class="isDarkMode ? 'bg-gray-800 text-gray-400' : 'bg-white text-gray-600 border border-gray-200'">
                          {{ task.details.targetPath || $t('admin.tasks.details.none') }}
                        </div>
                      </div>
                    </template>

                    <!-- 错误信息 (如果有) -->
                    <div v-if="task.error" class="md:col-span-2">
                      <div class="font-medium mb-1 text-red-600 dark:text-red-400">
                        {{ $t('admin.tasks.details.errorInfo') }}
                      </div>
                      <div class="text-xs p-2 rounded break-all bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 border border-red-200 dark:border-red-800">
                        {{ task.error }}
                      </div>
                    </div>
                  </div>
                </td>
              </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 分页组件 -->
    <div v-if="!isLoading && filteredTasks.length > 0" class="mt-4">
      <CommonPagination
        :dark-mode="isDarkMode"
        :pagination="pagination"
        mode="page"
        @page-changed="handlePageChange"
        @limit-changed="handleLimitChange"
      />
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { formatRelativeTime } from '@/utils/timeUtils.js';
import { formatFileSize } from '@/utils/fileUtils.js';
import CommonPagination from '@/components/common/CommonPagination.vue';
import { listJobs, getJobStatus, cancelJob, deleteJob, createJob } from '@/api/services/fsService.js';
import { useGlobalMessage } from '@/composables/core/useGlobalMessage.js';
import { useThemeMode } from '@/composables/core/useThemeMode.js';
import { useAuthStore } from '@/stores/authStore.js';

const { t } = useI18n();
const { showSuccess, showError, showWarning } = useGlobalMessage();
const { isDarkMode } = useThemeMode();
const authStore = useAuthStore();

// 状态管理
const tasks = ref([]);
const isLoading = ref(false);
const loadError = ref(null);
const selectedTasks = ref([]);
const expandedRows = ref([]);
const filters = ref({
  search: '',
  status: '',
});

// 分页
const pagination = ref({
  page: 1,
  limit: 20,
  total: 0,
  totalPages: 0,
});

// 轮询定时器
let pollTimer = null;

// 全选状态
const isAllSelected = computed(() => {
  return paginatedTasks.value.length > 0 &&
         paginatedTasks.value.every(task => selectedTasks.value.includes(task.id));
});

// 全部展开状态
const isAllExpanded = computed(() => {
  return paginatedTasks.value.length > 0 &&
         paginatedTasks.value.every(task => expandedRows.value.includes(task.id));
});

// 权限相关 - 使用挂载权限（与后端保持一致）
const hasTaskPermission = computed(() => {
  return authStore.hasPermission('mount');
});

// 检查用户是否可以查看特定任务
const canViewTask = (task) => {
  // 管理员可以查看所有任务
  if (authStore.isAdmin) {
    return true;
  }

  // API密钥只能查看自己的任务
  if (authStore.isApiKey) {
    return task.userId === authStore.userInfo?.id;
  }

  return false;
};

// 检查用户是否可以删除特定任务
const canDeleteTask = (task) => {
  // 首先要能查看任务
  if (!canViewTask(task)) {
    return false;
  }

  // 复制任务需要复制权限
  if (task.type === 'copy') {
    return hasTaskPermission.value;
  }

  // 其他任务类型的权限检查可以在这里扩展
  return hasTaskPermission.value;
};

// 筛选后的任务
const filteredTasks = computed(() => {
  let result = [...tasks.value];

  // 权限过滤：用户只能看到自己有权限的任务
  result = result.filter(task => canViewTask(task));

  // 状态筛选
  if (filters.value.status) {
    result = result.filter(task => task.status === filters.value.status);
  }

  // 搜索筛选
  if (filters.value.search) {
    const searchLower = filters.value.search.toLowerCase();
    result = result.filter(task =>
      task.name.toLowerCase().includes(searchLower) ||
      task.id.toLowerCase().includes(searchLower) ||
      task.details.sourcePath?.toLowerCase().includes(searchLower) ||
      task.details.targetPath?.toLowerCase().includes(searchLower)
    );
  }

  // 更新分页信息
  pagination.value.total = result.length;
  pagination.value.totalPages = Math.ceil(result.length / pagination.value.limit);

  return result;
});

// 分页后的任务
const paginatedTasks = computed(() => {
  const start = (pagination.value.page - 1) * pagination.value.limit;
  const end = start + pagination.value.limit;
  return filteredTasks.value.slice(start, end);
});

// 获取状态颜色
const getStatusColor = (status) => {
  const colors = {
    pending: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300',
    running: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
    completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
    partial: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
    failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    cancelled: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-400',
  };
  return colors[status] || colors.pending;
};

// 获取进度条颜色
const getProgressColor = (status) => {
  const colors = {
    running: 'bg-blue-500',
    completed: 'bg-green-500',
    partial: 'bg-yellow-500',
    failed: 'bg-red-500',
    cancelled: 'bg-gray-400',
    pending: 'bg-gray-300',
  };
  return colors[status] || colors.pending;
};

// 获取文件状态徽章样式类
const getFileStatusBadgeClass = (status) => {
  const classes = {
    success: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
    processing: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
    retrying: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
    failed: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    skipped: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/40 dark:text-yellow-300',
    pending: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400',
  };
  return classes[status] || classes.pending;
};

// 获取文件状态文字
const getFileStatusText = (status) => {
  return t(`admin.tasks.fileStatus.${status}`) || status;
};

// 获取文件进度条背景色类
const getFileProgressBgClass = (status) => {
  const classes = {
    success: 'bg-green-500/15 dark:bg-green-500/20',
    processing: 'bg-blue-500/15 dark:bg-blue-500/20',
    retrying: 'bg-orange-500/15 dark:bg-orange-500/20',
    failed: 'bg-red-500/10 dark:bg-red-500/15',
    skipped: 'bg-yellow-500/10 dark:bg-yellow-500/15',
    pending: 'bg-gray-200/50 dark:bg-gray-600/20',
  };
  return classes[status] || classes.pending;
};

// 获取文件进度条宽度
const getFileProgressWidth = (item) => {
  // 成功/失败/跳过 - 100%
  if (['success', 'failed', 'skipped'].includes(item.status)) {
    return '100%';
  }
  // 处理中或重试中 - 根据实际进度或显示动画效果
  if (item.status === 'processing' || item.status === 'retrying') {
    // 如果有进度数据则使用，否则显示50%作为视觉反馈
    if (item.progress !== undefined && item.progress > 0) {
      return `${Math.min(100, Math.max(5, item.progress))}%`;
    }
    return '50%'; // 默认动画位置
  }
  // 等待中 - 0%
  return '0%';
};

// 获取创建者徽章样式类（匹配文本/文件管理界面）
const getCreatorBadgeClass = (userId) => {
  const creatorType = getCreatorType(userId);

  switch (creatorType) {
    case 'admin':
      return 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100';
    case 'apikey':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-100';
    case 'system':
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    default:
      return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
  }
};

// 获取创建者类型（匹配挂载管理界面标准逻辑）
const getCreatorType = (userId) => {
  if (!userId) {
    return "system";
  }

  if (userId === "admin") {
    return "admin";
  }

  // 处理带"apikey:"前缀的API密钥ID
  if (typeof userId === "string" && userId.startsWith("apikey:")) {
    return "apikey";
  }

  // 检查是否在已知的API密钥列表中的UUID
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId) &&
      authStore.apiKeyNames && authStore.apiKeyNames[userId]) {
    return "apikey";
  }

  // UUID格式但不在已知API密钥列表中，则视为管理员
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return "admin";
  }

  // 默认为其他类型
  return "other";
};

// 获取创建者文本（匹配文本/文件管理界面）
const getCreatorText = (userId, keyName) => {
  const creatorType = getCreatorType(userId);

  switch (creatorType) {
    case 'admin':
      return '管理员';
    case 'apikey':
      return keyName ? `密钥：${keyName}` : `密钥：${userId.substring(0, 8)}...`;
    case 'system':
      return '未知来源';
    default:
      return userId;
  }
};

/**
 * 从路径中提取文件/文件夹名称
 * 安全处理末尾斜杠 (如 /path/folder/ → folder)
 */
const extractNameFromPath = (path) => {
  if (!path || typeof path !== 'string') return '';
  // 移除末尾斜杠后按 / 分割，过滤空字符串，取最后一个
  return path.replace(/\/+$/, '').split('/').filter(Boolean).pop() || '';
};

/**
 * 生成任务名称
 *
 * 命名规则:
 * - 单文件/单文件夹: 使用 taskName.single 模板 (如 "复制: document.pdf")
 * - 多项: 使用 taskName.batch 模板 (如 "复制: document.pdf 等 3 个项目")
 * - 空载荷: 使用 taskName.default 模板
 */
const generateTaskName = (jobData) => {
  if (!jobData) return t('admin.tasks.unknownFile');

  const items = jobData.payload?.items;
  if (!items || items.length === 0) {
    return t('admin.tasks.taskName.default', {
      id: jobData.jobId.substring(0, 8),
    });
  }

  const firstItem = items[0];
  const sourcePath = firstItem?.sourcePath || '';
  const sourceFileName = extractNameFromPath(sourcePath) || t('admin.tasks.unknownFile');

  if (items.length === 1) {
    return t('admin.tasks.taskName.single', { file: sourceFileName });
  } else {
    return t('admin.tasks.taskName.batch', {
      file: sourceFileName,
      count: items.length,
    });
  }
};

// 转换任务数据
/**
 * 进度计算逻辑:
 * - 如果有 totalBytes > 0: 使用字节级进度 (bytesTransferred / totalBytes)
 * - 否则: 使用文件级进度 (processedItems / totalItems)
 */
const transformTaskData = (jobData) => {
  const total = jobData.stats?.totalItems || 0;
  const success = jobData.stats?.successCount || 0;
  const failed = jobData.stats?.failedCount || 0;
  const skipped = jobData.stats?.skippedCount || 0;
  const processed = jobData.stats?.processedItems || 0;

  // 字节级进度 (跨存储复制时可用)
  const bytesTransferred = jobData.stats?.bytesTransferred || 0;
  const totalBytes = jobData.stats?.totalBytes || 0;

  // 智能进度计算
  // - 跨存储复制：bytesTransferred > 0 时使用字节级进度
  // - 同存储复制：bytesTransferred 始终为 0，使用文件级进度
  let progress = 0;
  if (totalBytes > 0 && bytesTransferred > 0) {
    // 跨存储复制（有字节传输）：使用字节级进度
    progress = Math.round((bytesTransferred / totalBytes) * 100);
  } else if (total > 0) {
    // 同存储复制 或 跨存储刚开始：使用文件级进度
    progress = Math.round((processed / total) * 100);
  }
  // 确保进度在 0-100 范围内
  progress = Math.min(100, Math.max(0, progress));

  const items = jobData.payload?.items || [];
  const firstItem = items[0] || {};

  // 获取每个文件的处理结果 (后端返回的 itemResults)
  const itemResults = jobData.stats?.itemResults || [];

  return {
    id: jobData.jobId,
    name: generateTaskName(jobData),
    type: jobData.taskType,
    status: jobData.status,
    userId: jobData.userId,
    keyName: jobData.keyName,
    createdAt: jobData.createdAt,
    relativeTime: formatRelativeTime(jobData.createdAt),
    progress,
    stats: {
      total,
      success,
      failed,
      skipped,
      bytesTransferred,
      totalBytes,
    },
    // 保留原有的 details (兼容单文件显示)
    details: {
      sourcePath: firstItem.sourcePath || '',
      targetPath: firstItem.targetPath || '',
    },
    // 新增: 所有文件的处理结果列表
    itemResults,
    error: jobData.error || null,
  };
};

// 加载任务列表
const loadTasks = async () => {
  isLoading.value = true;
  loadError.value = null;

  try {
    const response = await listJobs({ taskType: 'copy' });
    const jobsList = response?.data?.jobs || response?.jobs || [];
    tasks.value = jobsList.map(transformTaskData);
    pagination.value.page = 1;
  } catch (error) {
    console.error('Failed to load tasks:', error);
    loadError.value = t('admin.tasks.error.loadFailed');
    showError(loadError.value);
  } finally {
    isLoading.value = false;
  }
};

// 轮询运行中的任务
const pollRunningTasks = async () => {
  const runningTasks = tasks.value.filter(
    task => task.status === 'running' || task.status === 'pending'
  );

  if (runningTasks.length === 0) return;

  try {
    for (const task of runningTasks) {
      const response = await getJobStatus(task.id);
      const jobData = response?.data || response;
      const index = tasks.value.findIndex(t => t.id === task.id);
      if (index !== -1) {
        tasks.value[index] = transformTaskData(jobData);
      }
    }
  } catch (error) {
    console.error('Failed to poll tasks:', error);
  }
};

// 取消任务
const cancelTask = async (jobId) => {
  try {
    await cancelJob(jobId);
    showSuccess(t('admin.tasks.actions.cancel'));
    await loadTasks();
  } catch (error) {
    console.error('Failed to cancel task:', error);
    showError(t('admin.tasks.error.cancelFailed'));
  }
};

// 切换任务选择
const toggleTaskSelection = (taskId) => {
  const index = selectedTasks.value.indexOf(taskId);
  if (index > -1) {
    selectedTasks.value.splice(index, 1);
  } else {
    selectedTasks.value.push(taskId);
  }
};

// 切换全选
const toggleSelectAll = () => {
  if (isAllSelected.value) {
    // 取消当前页的所有选择
    paginatedTasks.value.forEach(task => {
      const index = selectedTasks.value.indexOf(task.id);
      if (index > -1) {
        selectedTasks.value.splice(index, 1);
      }
    });
  } else {
    // 选择当前页的所有任务
    paginatedTasks.value.forEach(task => {
      if (!selectedTasks.value.includes(task.id)) {
        selectedTasks.value.push(task.id);
      }
    });
  }
};

// 切换展开行
const toggleExpandRow = (taskId) => {
  const index = expandedRows.value.indexOf(taskId);
  if (index > -1) {
    expandedRows.value.splice(index, 1);
  } else {
    expandedRows.value.push(taskId);
  }
};

// 切换全部展开/收起
const toggleExpandAll = () => {
  if (isAllExpanded.value) {
    // 收起当前页的所有行
    paginatedTasks.value.forEach(task => {
      const index = expandedRows.value.indexOf(task.id);
      if (index > -1) {
        expandedRows.value.splice(index, 1);
      }
    });
  } else {
    // 展开当前页的所有行
    paginatedTasks.value.forEach(task => {
      if (!expandedRows.value.includes(task.id)) {
        expandedRows.value.push(task.id);
      }
    });
  }
};

// 删除单个任务
const deleteSingleTask = async (taskId) => {
  // 权限验证：检查复制权限
  if (!hasTaskPermission.value) {
    showError(t('admin.common.permissionDenied.title'));
    return;
  }

  // 查找任务
  const task = tasks.value.find(t => t.id === taskId);
  if (!task) {
    showError(t('admin.tasks.error.taskNotFound'));
    return;
  }

  // 检查任务状态，不允许删除运行中的任务
  if (task.status === 'pending' || task.status === 'running') {
    showWarning(t('admin.tasks.error.cannotDeleteRunning'));
    return;
  }

  // 确认删除
  if (!confirm(t('admin.tasks.confirmDelete.single', { name: task.name }))) {
    return;
  }

  try {
    await deleteJob(taskId);
    showSuccess(t('admin.tasks.success.deleted'));

    // 从本地列表移除
    const index = tasks.value.findIndex(t => t.id === taskId);
    if (index > -1) {
      tasks.value.splice(index, 1);
    }

    // 从选中列表移除
    const selectedIndex = selectedTasks.value.indexOf(taskId);
    if (selectedIndex > -1) {
      selectedTasks.value.splice(selectedIndex, 1);
    }
  } catch (error) {
    console.error('Failed to delete task:', error);
    showError(t('admin.tasks.error.deleteFailed'));
  }
};

// 批量删除任务
const deleteSelectedTasks = async () => {
  if (selectedTasks.value.length === 0) return;

  // 权限验证：检查复制权限
  if (!hasTaskPermission.value) {
    showError(t('admin.common.permissionDenied.title'));
    return;
  }

  // 检查是否有运行中的任务
  const runningTasks = selectedTasks.value.filter(taskId => {
    const task = tasks.value.find(t => t.id === taskId);
    return task && (task.status === 'pending' || task.status === 'running');
  });

  if (runningTasks.length > 0) {
    showWarning(t('admin.tasks.error.cannotDeleteRunningBatch', { count: runningTasks.length }));
    return;
  }

  // 确认批量删除
  if (!confirm(t('admin.tasks.confirmDelete.batch', { count: selectedTasks.value.length }))) {
    return;
  }

  // 执行批量删除
  let successCount = 0;
  let failedCount = 0;

  for (const taskId of selectedTasks.value) {
    try {
      await deleteJob(taskId);
      successCount++;

      // 从本地列表移除
      const index = tasks.value.findIndex(t => t.id === taskId);
      if (index > -1) {
        tasks.value.splice(index, 1);
      }
    } catch (error) {
      console.error(`Failed to delete task ${taskId}:`, error);
      failedCount++;
    }
  }

  // 清空选中列表
  selectedTasks.value = [];

  // 显示结果
  if (failedCount === 0) {
    showSuccess(t('admin.tasks.success.deletedBatch', { count: successCount }));
  } else if (successCount === 0) {
    showError(t('admin.tasks.error.deleteBatchFailed'));
  } else {
    showWarning(t('admin.tasks.success.deletedPartial', { success: successCount, failed: failedCount }));
  }
};

// 处理页码变化
const handlePageChange = (page) => {
  pagination.value.page = page;
};

// 处理每页数量变化
const handleLimitChange = (limit) => {
  pagination.value.limit = limit;
  pagination.value.page = 1;
};

// 监听筛选条件变化,重置到第一页
watch(filters, () => {
  pagination.value.page = 1;
}, { deep: true });

// 组件挂载
onMounted(async () => {
  await loadTasks();

  // 启动轮询
  pollTimer = setInterval(pollRunningTasks, 5000);
});

/**
 * 重试单个失败文件
 * 创建新任务，仅包含该失败文件
 */
const retryFailedFile = async (task, failedItem) => {
  // 权限验证
  if (!hasTaskPermission.value) {
    showError(t('admin.common.permissionDenied.title'));
    return;
  }

  // 检查任务是否还在运行
  if (task.status === 'running' || task.status === 'pending') {
    showWarning(t('admin.tasks.error.cannotRetryRunning'));
    return;
  }

  try {
    // 创建新任务，仅包含该失败文件
    const response = await createJob('copy', {
      items: [
        {
          sourcePath: failedItem.sourcePath,
          targetPath: failedItem.targetPath,
        }
      ]
    }, {
      skipExisting: task.payload?.options?.skipExisting ?? true,
      maxConcurrency: 1,
    });

    showSuccess(t('admin.tasks.success.retryStarted'));

    // 刷新任务列表
    await loadTasks();
  } catch (error) {
    console.error('Failed to retry file:', error);
    showError(t('admin.tasks.error.retryFailed'));
  }
};

/**
 * 重试任务中所有失败的文件
 * 创建新任务，包含所有失败文件
 */
const retryAllFailedFiles = async (taskId) => {
  // 权限验证
  if (!hasTaskPermission.value) {
    showError(t('admin.common.permissionDenied.title'));
    return;
  }

  // 查找任务
  const task = tasks.value.find(t => t.id === taskId);
  if (!task) {
    showError(t('admin.tasks.error.taskNotFound'));
    return;
  }

  // 检查任务是否还在运行
  if (task.status === 'running' || task.status === 'pending') {
    showWarning(t('admin.tasks.error.cannotRetryRunning'));
    return;
  }

  // 提取所有失败的文件
  const failedItems = (task.itemResults || [])
    .filter(item => item.status === 'failed')
    .map(item => ({
      sourcePath: item.sourcePath,
      targetPath: item.targetPath,
    }));

  if (failedItems.length === 0) {
    showWarning(t('admin.tasks.error.noFailedFiles'));
    return;
  }

  try {
    // 创建新任务
    const response = await createJob('copy', {
      items: failedItems
    }, {
      skipExisting: task.payload?.options?.skipExisting ?? true,
      maxConcurrency: task.payload?.options?.maxConcurrency || 10,
    });

    showSuccess(t('admin.tasks.success.retryStartedWithCount', { count: failedItems.length }));

    // 刷新任务列表
    await loadTasks();
  } catch (error) {
    console.error('Failed to retry all failed files:', error);
    showError(t('admin.tasks.error.retryFailed'));
  }
};

// 组件卸载
onUnmounted(() => {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
});
</script>