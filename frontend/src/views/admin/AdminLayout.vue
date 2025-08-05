<template>
  <div class="h-screen" :class="darkMode ? 'bg-gray-900' : 'bg-gray-100'">
    <AdminSidebar
      :dark-mode="darkMode"
      :permissions="permissions"
      :is-mobile-sidebar-open="isMobileSidebarOpen"
      @close-mobile-sidebar="closeMobileSidebar"
      @logout="handleLogout"
    />

    <!-- 移动端顶部栏 -->
    <AdminHeader :dark-mode="darkMode" @toggle-mobile-sidebar="toggleMobileSidebar" />

    <!-- 主内容区域 - 为侧边栏和header留出空间，使用固定定位遮住自定义页脚 -->
    <main class="fixed md:left-64 left-0 top-32 md:top-16 right-0 bottom-0 overflow-y-auto focus:outline-none z-40" :class="darkMode ? 'bg-gray-900' : 'bg-gray-100'">
      <!-- 内容区域 -->
      <div class="mx-auto w-full px-2 sm:px-4 md:px-6 lg:px-8 mt-2 md:mt-4 pb-4" style="max-width: 1280px">
        <div class="rounded-lg flex-1 flex flex-col" :class="darkMode ? 'bg-gray-800' : 'bg-white border border-gray-200'">
          <!-- 页面内容 -->
          <div class="p-2 md:p-4 flex-1 flex flex-col">
            <router-view :dark-mode="darkMode" :permissions="permissions" @logout="handleLogout" />
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup>
import { ref } from "vue";
import AdminSidebar from "@/components/admin/AdminSidebar.vue";
import AdminHeader from "@/components/admin/AdminHeader.vue";

const props = defineProps({
  darkMode: {
    type: Boolean,
    required: true,
  },
  permissions: {
    type: Object,
    required: true,
  },
});

const isMobileSidebarOpen = ref(false);

const toggleMobileSidebar = () => {
  isMobileSidebarOpen.value = !isMobileSidebarOpen.value;
};

const closeMobileSidebar = () => {
  isMobileSidebarOpen.value = false;
};

const emit = defineEmits(["logout"]);

const handleLogout = () => {
  emit("logout");
};
</script>


