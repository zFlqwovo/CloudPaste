<template>
  <div class="file-upload-container mx-auto px-3 sm:px-6 flex-1 flex flex-col pt-6 sm:pt-8 w-full max-w-full sm:max-w-6xl">
    <div class="header mb-4 border-b pb-2" :class="darkMode ? 'border-gray-700' : 'border-gray-200'">
      <h2 class="text-xl font-semibold">{{ t("file.uploadPageTitle") }}</h2>
    </div>

    <!-- 权限管理组件 -->
    <PermissionManager
      :dark-mode="darkMode"
      permission-type="file"
      :permission-required-text="$t('file.permissionRequired')"
      :login-auth-text="$t('file.loginOrAuth')"
      @permission-change="handlePermissionChange"
      @navigate-to-admin="navigateToAdmin"
    />

    <div class="main-content" v-if="hasPermission">
      <!-- 文件上传区域 -->
      <div class="card mb-6 p-4 sm:p-6">
        <FileUploader
          :dark-mode="darkMode"
          :is-admin="isAdmin"
          @upload-success="handleUploadSuccess"
          @upload-error="handleUploadError"
        />
      </div>

      <!-- 最近上传记录 -->
      <div v-if="recentFiles.length > 0" class="card p-4 sm:p-6">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-lg font-medium">{{ t("file.recentUploads") }}</h3>
          <span class="text-sm" :class="darkMode ? 'text-gray-400' : 'text-gray-500'">{{ t("file.showingRecent") }}</span>
        </div>
        <FileList :dark-mode="darkMode" :files="recentFiles" :loading="loadingFiles" :user-type="isAdmin ? 'admin' : 'apikey'" @refresh="loadFiles" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, computed, onBeforeUnmount } from "vue";
import { storeToRefs } from "pinia";
import FileUploader from "@/modules/upload/public/components/FileUploader.vue";
import FileList from "@/modules/upload/public/components/FileList.vue";
import PermissionManager from "@/components/common/PermissionManager.vue";
import { useI18n } from "vue-i18n"; // 导入i18n
import { useAuthStore } from "@/stores/authStore.js";
import { useStorageConfigsStore } from "@/stores/storageConfigsStore.js";
import { useUploadService } from "@/modules/upload/services/uploadService.js";
import { useGlobalMessage } from "@/composables/core/useGlobalMessage.js";

const { t } = useI18n(); // 初始化i18n
const { getRecentFiles } = useUploadService();
const { showSuccess, showError, showWarning } = useGlobalMessage();

// 使用认证Store
const authStore = useAuthStore();
const { isAdmin, hasFilePermission } = storeToRefs(authStore);

const props = defineProps({
  darkMode: {
    type: Boolean,
    default: false,
  },
});

// 数据状态
const storageConfigsStore = useStorageConfigsStore();
const files = ref([]);
const loadingFiles = ref(false);

// 从Store获取权限状态的计算属性
const hasPermission = computed(() => hasFilePermission.value);

// 计算最近3条记录
const recentFiles = computed(() => {
  return files.value.slice(0, 3);
});

// 导航到管理页面
const navigateToAdmin = () => {
  import("@/router").then(({ routerUtils }) => {
    routerUtils.navigateTo("admin");
  });
};

// 权限变化处理 - 当权限状态改变时执行相应的业务逻辑
const handlePermissionChange = async (hasPermissionValue) => {
  console.log("FileUpload: 权限状态变化", hasPermissionValue);

  if (hasPermissionValue) {
    console.log("用户获得权限，开始加载配置和文件列表");
    await Promise.all([loadStorageConfigs({ force: true }), loadFiles()]);
  } else {
    console.log("用户失去权限，清空数据");
    files.value = [];
  }
};

// 加载存储配置（默认抓取前100个即可覆盖常见场景）
const loadStorageConfigs = async (options = {}) => {
  if (!hasPermission.value) return;

  try {
    if (options.force) {
      await storageConfigsStore.refreshConfigs();
    } else {
      await storageConfigsStore.loadConfigs();
    }
  } catch (error) {
    console.error("加载存储配置失败:", error);
  }
};

// 加载已上传文件列表
const loadFiles = async () => {
  if (!hasPermission.value) return;

  loadingFiles.value = true;
  try {
    const list = await getRecentFiles(5);
    files.value = list;
  } catch (error) {
    console.error("加载文件列表失败:", error);
    showError(`${t("file.messages.getFileDetailFailed")}: ${error.message || t("file.messages.unknownError")}`);
  } finally {
    loadingFiles.value = false;
  }
};

// 处理上传成功事件
const handleUploadSuccess = (fileData) => {
  // 刷新文件列表
  loadFiles();

  showSuccess(t("file.uploadSuccessful"));
};

// 处理上传错误事件
const handleUploadError = (error) => {
  if (
    error &&
    error.message &&
    (error.message.includes("存储空间不足") ||
      error.message.includes("insufficient storage") ||
      error.message.includes("容量") ||
      error.message.includes("storage limit"))
  ) {
    showWarning(error.message);
  } else {
    showError(error.message || t("file.messages.unknownError"));
  }
};

// 组件挂载时初始化
onMounted(() => {
  console.log("FileUpload组件已挂载");
  // 初始化与后续权限变化均通过 PermissionManager 的 permission-change 事件驱动
});
</script>

<style scoped>
/* 响应式设计 */
@media (max-width: 640px) {
  .file-upload-container {
    padding-top: 1rem;
  }
}
</style>
