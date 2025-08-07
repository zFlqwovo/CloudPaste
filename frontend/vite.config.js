import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import { VitePWA } from "vite-plugin-pwa";
import { fileURLToPath, URL } from "node:url";

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  // 加载环境变量
  const env = loadEnv(mode, process.cwd(), "");

  // 统一版本管理
  const APP_VERSION = "0.7.7";
  const isDev = command === "serve";

  // 打印环境变量，帮助调试
  console.log("Vite环境变量:", {
    VITE_BACKEND_URL: env.VITE_BACKEND_URL || "未设置",
    VITE_APP_ENV: env.VITE_APP_ENV || "未设置",
    APP_VERSION: APP_VERSION,
    MODE: mode,
    COMMAND: command,
  });

  return {
    define: {
      // 注入版本号到应用中
      __APP_VERSION__: JSON.stringify(APP_VERSION),
      // 注入环境变量到应用中
      __APP_ENV__: JSON.stringify(env.VITE_APP_ENV || "production"),
      __BACKEND_URL__: JSON.stringify(env.VITE_BACKEND_URL || ""),
    },
    plugins: [
      vue(),
      VitePWA({
        registerType: "autoUpdate",
        injectRegister: "auto", //自动注入更新检测代码
        devOptions: {
          enabled: true, // 开发环境启用PWA
        },
        workbox: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2,ttf}"],
          maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
          skipWaiting: true,
          clientsClaim: true,
          cleanupOutdatedCaches: true,
          navigateFallback: "index.html",
          navigateFallbackAllowlist: [/^\/$/, /^\/upload$/, /^\/admin/, /^\/paste\/.+/, /^\/file\/.+/, /^\/mount-explorer/],

          // 集成自定义Service Worker代码以支持Background Sync API
          importScripts: ["/sw-background-sync.js"],

          // 基于主流PWA最佳实践的正确缓存策略
          runtimeCaching: [
            // 应用静态资源 - StaleWhileRevalidate
            {
              urlPattern: ({ request }) => request.destination === "style" || request.destination === "script" || request.destination === "worker",
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "app-static-resources",
                expiration: {
                  maxEntries: 1000,
                  maxAgeSeconds: 7 * 24 * 60 * 60, // 7天（依赖Vite版本控制）
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // 字体文件 - CacheFirst（字体很少变化，可长期缓存）
            {
              urlPattern: ({ request }) => request.destination === "font",
              handler: "CacheFirst",
              options: {
                cacheName: "fonts",
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 30 * 24 * 60 * 60, // 30天（字体变化频率低）
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // 第三方CDN资源 - CacheFirst（外部资源稳定）
            {
              urlPattern: ({ url }) =>
                url.origin !== self.location.origin &&
                (url.hostname.includes("cdn") ||
                  url.hostname.includes("googleapis") ||
                  url.hostname.includes("gstatic") ||
                  url.hostname.includes("jsdelivr") ||
                  url.hostname.includes("unpkg")),
              handler: "CacheFirst",
              options: {
                cacheName: "external-cdn-resources",
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 30 * 24 * 60 * 60, // 30天（第三方资源稳定）
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // 图廊图片 - NetworkFirst
            {
              urlPattern: ({ request, url }) =>
                request.destination === "image" && (url.pathname.includes("/api/") || url.searchParams.has("X-Amz-Algorithm") || url.hostname !== self.location.hostname),
              handler: "NetworkFirst",
              options: {
                cacheName: "gallery-images",
                expiration: {
                  maxEntries: 300, // 增加图廊容量
                  maxAgeSeconds: 7 * 24 * 60 * 60, // 7天（图片内容稳定）
                },
                networkTimeoutSeconds: 10, // NetworkFirst支持此参数
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // 用户媒体文件 - NetworkFirst（大文件适度缓存）
            {
              urlPattern: ({ request, url }) =>
                (request.destination === "video" || request.destination === "audio" || /\.(mp4|webm|ogg|mp3|wav|flac|aac)$/i.test(url.pathname)) &&
                (url.pathname.includes("/api/") || url.searchParams.has("X-Amz-Algorithm") || url.hostname !== self.location.hostname),
              handler: "NetworkFirst",
              options: {
                cacheName: "user-media",
                expiration: {
                  maxEntries: 30,
                  maxAgeSeconds: 2 * 60 * 60, // 2小时（媒体文件较大，适度缓存）
                },
                networkTimeoutSeconds: 15,
                cacheableResponse: {
                  statuses: [0, 200, 206], // 支持范围请求
                },
                rangeRequests: true,
              },
            },

            // 用户文档文件 - NetworkFirst（文档快速更新）
            {
              urlPattern: ({ url }) =>
                /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|txt|md)$/i.test(url.pathname) &&
                (url.pathname.includes("/api/") || url.searchParams.has("X-Amz-Algorithm") || url.hostname !== self.location.hostname),
              handler: "NetworkFirst",
              options: {
                cacheName: "user-documents",
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 2 * 60 * 60,
                },
                networkTimeoutSeconds: 10,
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // 应用内置图片 - StaleWhileRevalidate（应用资源）
            {
              urlPattern: ({ request, url }) => request.destination === "image" && url.origin === self.location.origin && !url.pathname.includes("/api/"),
              handler: "StaleWhileRevalidate",
              options: {
                cacheName: "app-images",
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 7 * 24 * 60 * 60, // 7天（应用图片）
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // 系统API缓存 - NetworkFirst
            {
              urlPattern: /^.*\/api\/(system\/max-upload-size|health|version).*$/,
              handler: "NetworkFirst",
              options: {
                cacheName: "system-api",
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 30 * 60, // 30分钟
                },
                networkTimeoutSeconds: 3,
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // 文件系统API缓存 - NetworkFirst
            {
              urlPattern: /^.*\/api\/fs\/.*$/,
              handler: "NetworkFirst",
              options: {
                cacheName: "fs-api",
                expiration: {
                  maxEntries: 200, // 增加容量支持更多文件信息
                  maxAgeSeconds: 30 * 60, // 30分钟（文件信息相对稳定）
                },
                networkTimeoutSeconds: 8, // 增加超时时间
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // 文本分享API缓存 - NetworkFirst（内容短期缓存）
            {
              urlPattern: /^.*\/api\/(pastes|paste|raw)\/.*$/,
              handler: "NetworkFirst",
              options: {
                cacheName: "pastes-api",
                expiration: {
                  maxEntries: 30,
                  maxAgeSeconds: 5 * 60, // 5分钟（文本内容短期缓存）
                },
                networkTimeoutSeconds: 4,
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // 配置管理API缓存 - NetworkFirst
            {
              urlPattern: /^.*\/api\/(admin\/mounts|admin\/api-keys|admin\/system-settings|files)\/.*$/,
              handler: "NetworkFirst",
              options: {
                cacheName: "config-api",
                expiration: {
                  maxEntries: 30,
                  maxAgeSeconds: 30 * 60, // 30分钟
                },
                networkTimeoutSeconds: 4,
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // 搜索API缓存 - NetworkFirst
            {
              urlPattern: /^.*\/api\/fs\/search.*$/,
              handler: "NetworkFirst",
              options: {
                cacheName: "search-api",
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 5 * 60, // 5分钟
                },
                networkTimeoutSeconds: 6,
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // 上传API缓存 - NetworkFirst
            {
              urlPattern: /^.*\/api\/(upload|fs\/upload|fs\/presign|fs\/multipart|url)\/.*$/,
              handler: "NetworkFirst",
              options: {
                cacheName: "upload-api",
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 10 * 60, // 10分钟
                },
                networkTimeoutSeconds: 8,
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // 公共API缓存 - NetworkFirst
            {
              urlPattern: /^.*\/api\/public\/.*$/,
              handler: "NetworkFirst",
              options: {
                cacheName: "public-api",
                expiration: {
                  maxEntries: 50,
                  maxAgeSeconds: 30 * 60, // 30分钟
                },
                networkTimeoutSeconds: 4,
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // WebDAV缓存 - NetworkFirst（WebDAV操作无缓存）
            {
              urlPattern: /^.*\/dav\/.*$/,
              handler: "NetworkFirst",
              options: {
                cacheName: "webdav-api",
                expiration: {
                  maxEntries: 30,
                  maxAgeSeconds: 1 * 60, // 1分钟（WebDAV操作几乎无缓存）
                },
                networkTimeoutSeconds: 10,
                cacheableResponse: {
                  statuses: [0, 200, 207], // 包含WebDAV的207状态码
                },
              },
            },

            // 预签名URL缓存 - NetworkFirst
            {
              urlPattern: ({ url }) => url.searchParams.has("X-Amz-Algorithm") || url.searchParams.has("Signature") || url.pathname.includes("/presigned/"),
              handler: "NetworkFirst",
              options: {
                cacheName: "presigned-urls",
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 30 * 60, // 30分钟
                },
                networkTimeoutSeconds: 8,
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // 页面导航缓存 - NetworkFirst（页面短期缓存）
            {
              urlPattern: ({ request }) => request.mode === "navigate",
              handler: "NetworkFirst",
              options: {
                cacheName: "pages",
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 2 * 60 * 60, // 2小时
                },
                networkTimeoutSeconds: 3,
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },

            // 通用API回退缓存 - NetworkFirst（其他API短期缓存）
            {
              urlPattern: /^.*\/api\/.*$/,
              handler: "NetworkFirst",
              options: {
                cacheName: "api-fallback",
                expiration: {
                  maxEntries: 30,
                  maxAgeSeconds: 10 * 60, // 10分钟
                },
                networkTimeoutSeconds: 5,
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
        includeAssets: ["favicon.ico", "apple-touch-icon.png", "robots.txt", "dist/**/*"],
        manifest: {
          name: "CloudPaste",
          short_name: "CloudPaste",
          description: "安全分享您的内容，支持 Markdown 编辑和文件上传",
          theme_color: "#0ea5e9",
          background_color: "#ffffff",
          display: "standalone",
          orientation: "portrait-primary", // 与manifest.json保持一致
          scope: "/",
          start_url: "/",
          lang: "zh-CN", // 添加语言设置
          categories: ["productivity", "utilities"], // 添加应用分类
          icons: [
            {
              src: "icons/icons-32.png",
              sizes: "32x32",
              type: "image/png",
            },
            {
              src: "icons/icon-96.png",
              sizes: "96x96",
              type: "image/png",
            },
            {
              src: "icons/icon-192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "icons/icon-512.png",
              sizes: "512x512",
              type: "image/png",
            },
            {
              src: "icons/icon-512-maskable.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
          shortcuts: [
            {
              name: "文件上传",
              short_name: "上传",
              description: "快速上传文件",
              url: "/upload",
              icons: [
                {
                  src: "icons/shortcut-upload-96.png",
                  sizes: "96x96",
                },
              ],
            },
          ],
        },
      }),
    ],
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      port: 3000,
      open: true,
      // 设置代理 - 仅在本地开发模式下使用
      proxy: {
        // 当 VITE_BACKEND_URL 为本地地址时，将请求代理到本地worker
        "/api": {
          target: env.VITE_BACKEND_URL || "http://localhost:8787",
          changeOrigin: true,
          secure: false,
          // 打印代理日志
          configure: (proxy, _options) => {
            proxy.on("error", (err, _req, _res) => {
              console.log("代理错误", err);
            });
            proxy.on("proxyReq", (_proxyReq, req, _res) => {
              console.log("代理请求:", req.method, req.url);
            });
            proxy.on("proxyRes", (proxyRes, req, _res) => {
              console.log("代理响应:", req.method, req.url, proxyRes.statusCode);
            });
          },
        },
      },
    },
    optimizeDeps: {
      include: ["vue-i18n", "chart.js", "qrcode"],
      // 移除vditor排除配置，因为现在从本地dist目录加载
    },
    build: {
      minify: "terser",
      terserOptions: {
        compress: {
          drop_console: true,
        },
      },
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: {
            // 将大型库分离到单独的 chunk
            "vendor-vue": ["vue", "vue-router", "vue-i18n"],
            "vendor-charts": ["chart.js", "vue-chartjs"],
            "vendor-utils": ["axios", "qrcode", "file-saver", "docx", "html-to-image"],
          },
        },
      },
    },
  };
});
