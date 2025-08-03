import { DbTables } from "../constants/index.js";
import crypto from "crypto";

/**
 * 初始化数据库表结构
 * @param {D1Database} db - D1数据库实例
 */
export async function initDatabase(db) {
  console.log("开始初始化数据库表结构...");

  // 创建pastes表 - 存储文本分享数据
  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS ${DbTables.PASTES} (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        content TEXT NOT NULL,
        remark TEXT,
        password TEXT,
        expires_at DATETIME,
        max_views INTEGER,
        views INTEGER DEFAULT 0,  
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `
    )
    .run();

  // 创建pastes表索引
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_pastes_slug ON ${DbTables.PASTES}(slug)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_pastes_created_at ON ${DbTables.PASTES}(created_at DESC)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_pastes_created_by ON ${DbTables.PASTES}(created_by)`).run();

  // 创建文本密码表
  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS ${DbTables.PASTE_PASSWORDS} (
        paste_id TEXT PRIMARY KEY,
        plain_password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (paste_id) REFERENCES ${DbTables.PASTES}(id) ON DELETE CASCADE
      )
    `
    )
    .run();

  // 创建admins表 - 存储管理员信息
  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS ${DbTables.ADMINS} (
        id TEXT PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `
    )
    .run();

  // 创建admin_tokens表 - 存储管理员认证令牌
  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS ${DbTables.ADMIN_TOKENS} (
        token TEXT PRIMARY KEY,
        admin_id TEXT NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (admin_id) REFERENCES ${DbTables.ADMINS}(id) ON DELETE CASCADE
      )
    `
    )
    .run();

  // 创建api_keys表 - 存储API密钥（位标志权限系统）
  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS ${DbTables.API_KEYS} (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        key TEXT UNIQUE NOT NULL,
        permissions INTEGER DEFAULT 0,
        role TEXT DEFAULT 'GENERAL',
        basic_path TEXT DEFAULT '/',
        is_guest BOOLEAN DEFAULT 0,
        last_used DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME NOT NULL
      )
    `
    )
    .run();

  // 创建s3_configs表 - 存储S3配置信息
  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS ${DbTables.S3_CONFIGS} (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        provider_type TEXT NOT NULL,
        endpoint_url TEXT NOT NULL,
        bucket_name TEXT NOT NULL,
        region TEXT,
        access_key_id TEXT NOT NULL,
        secret_access_key TEXT NOT NULL,
        path_style BOOLEAN DEFAULT 0,
        default_folder TEXT DEFAULT '',
        is_public BOOLEAN DEFAULT 0,
        is_default BOOLEAN DEFAULT 0,
        total_storage_bytes BIGINT,
        custom_host TEXT,
        signature_expires_in INTEGER DEFAULT 3600,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used DATETIME,
        admin_id TEXT,
        FOREIGN KEY (admin_id) REFERENCES ${DbTables.ADMINS}(id) ON DELETE CASCADE
      )
    `
    )
    .run();

  // 创建files表 - 存储已上传文件的元数据（支持多存储类型）
  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS ${DbTables.FILES} (
        id TEXT PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        filename TEXT NOT NULL,

        -- 存储引用（支持多存储类型）
        storage_config_id TEXT NOT NULL,
        storage_type TEXT NOT NULL,
        storage_path TEXT NOT NULL,
        file_path TEXT,

        -- 文件元数据
        mimetype TEXT NOT NULL,
        size INTEGER NOT NULL,
        etag TEXT,

        -- 分享控制（保持现有功能）
        remark TEXT,
        password TEXT,
        expires_at DATETIME,
        max_views INTEGER,
        views INTEGER DEFAULT 0,
        use_proxy BOOLEAN DEFAULT 0,

        -- 元数据
        created_by TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `
    )
    .run();

  // 创建files表索引
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_slug ON ${DbTables.FILES}(slug)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_storage_config_id ON ${DbTables.FILES}(storage_config_id)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_storage_type ON ${DbTables.FILES}(storage_type)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_file_path ON ${DbTables.FILES}(file_path)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_created_at ON ${DbTables.FILES}(created_at)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_expires_at ON ${DbTables.FILES}(expires_at)`).run();

  // 创建file_passwords表 - 存储文件密码
  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS ${DbTables.FILE_PASSWORDS} (
        file_id TEXT PRIMARY KEY,
        plain_password TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (file_id) REFERENCES ${DbTables.FILES}(id) ON DELETE CASCADE
      )
    `
    )
    .run();

  // 创建system_settings表 - 存储系统设置
  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS ${DbTables.SYSTEM_SETTINGS} (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        description TEXT,
        type TEXT DEFAULT 'string',
        group_id INTEGER DEFAULT 1,
        options TEXT,
        sort_order INTEGER DEFAULT 0,
        flags INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `
    )
    .run();

  // 创建storage_mounts表 - 存储挂载配置
  await db
    .prepare(
      `
      CREATE TABLE IF NOT EXISTS ${DbTables.STORAGE_MOUNTS} (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        storage_type TEXT NOT NULL,
        storage_config_id TEXT,
        mount_path TEXT NOT NULL,
        remark TEXT,
        is_active BOOLEAN DEFAULT 1,
        created_by TEXT NOT NULL,
        sort_order INTEGER DEFAULT 0,
        cache_ttl INTEGER DEFAULT 300,
        web_proxy BOOLEAN DEFAULT 0,
        webdav_policy TEXT DEFAULT '302_redirect',
        enable_sign BOOLEAN DEFAULT 0,
        sign_expires INTEGER DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_used DATETIME
      )
    `
    )
    .run();

  // 创建storage_mounts表索引
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_storage_mounts_mount_path ON ${DbTables.STORAGE_MOUNTS}(mount_path)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_storage_mounts_storage_config_id ON ${DbTables.STORAGE_MOUNTS}(storage_config_id)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_storage_mounts_created_by ON ${DbTables.STORAGE_MOUNTS}(created_by)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_storage_mounts_is_active ON ${DbTables.STORAGE_MOUNTS}(is_active)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS idx_storage_mounts_sort_order ON ${DbTables.STORAGE_MOUNTS}(sort_order)`).run();

  // 检查是否已存在最大上传限制设置
  const maxUploadSize = await db
    .prepare(
      `
      SELECT value FROM ${DbTables.SYSTEM_SETTINGS}
      WHERE key = 'max_upload_size'
    `
    )
    .first();

  // 如果不存在，添加默认值
  if (!maxUploadSize) {
    await db
      .prepare(
        `
        INSERT INTO ${DbTables.SYSTEM_SETTINGS} (key, value, description, type, group_id, options, sort_order, flags)
        VALUES ('max_upload_size', '100', '单次最大上传文件大小限制(MB)', 'number', 1, NULL, 1, 0)
      `
      )
      .run();
  }

  // 检查是否已存在WebDAV上传模式设置
  const webdavUploadMode = await db
    .prepare(
      `
      SELECT value FROM ${DbTables.SYSTEM_SETTINGS}
      WHERE key = 'webdav_upload_mode'
    `
    )
    .first();

  // 如果不存在，添加默认值
  if (!webdavUploadMode) {
    const options = JSON.stringify([
      { value: "direct", label: "直接上传" },
      { value: "multipart", label: "分片上传" },
    ]);
    await db
      .prepare(
        `
        INSERT INTO ${DbTables.SYSTEM_SETTINGS} (key, value, description, type, group_id, options, sort_order, flags)
        VALUES ('webdav_upload_mode', 'direct', 'WebDAV客户端的上传模式选择。', 'select', 3, ?, 1, 0)
      `
      )
      .bind(options)
      .run();
  }

  // 检查是否已存在代理签名全局设置
  const proxySignAll = await db
    .prepare(
      `
      SELECT value FROM ${DbTables.SYSTEM_SETTINGS}
      WHERE key = 'proxy_sign_all'
    `
    )
    .first();

  // 如果不存在，添加默认值
  if (!proxySignAll) {
    await db
      .prepare(
        `
        INSERT INTO ${DbTables.SYSTEM_SETTINGS} (key, value, description, type, group_id, options, sort_order, flags)
        VALUES ('proxy_sign_all', 'true', '是否对所有文件访问请求进行代理签名。', 'bool', 1, NULL, 2, 0)
      `
      )
      .run();
  }

  // 检查是否已存在代理签名过期时间设置
  const proxySignExpires = await db
    .prepare(
      `
      SELECT value FROM ${DbTables.SYSTEM_SETTINGS}
      WHERE key = 'proxy_sign_expires'
    `
    )
    .first();

  // 如果不存在，添加默认值
  if (!proxySignExpires) {
    await db
      .prepare(
        `
        INSERT INTO ${DbTables.SYSTEM_SETTINGS} (key, value, description, type, group_id, options, sort_order, flags)
        VALUES ('proxy_sign_expires', '0', '代理签名的过期时间（秒），0表示永不过期。', 'number', 1, NULL, 3, 0)
      `
      )
      .run();
  }

  // 检查是否需要创建默认管理员账户
  const adminCount = await db.prepare(`SELECT COUNT(*) as count FROM ${DbTables.ADMINS}`).first();

  if (adminCount.count === 0) {
    const adminId = crypto.randomUUID();
    // 密码"admin123"的SHA-256哈希
    const defaultPassword = "240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9";

    await db
      .prepare(
        `
        INSERT INTO ${DbTables.ADMINS} (id, username, password)
        VALUES (?, ?, ?)
      `
      )
      .bind(adminId, "admin", defaultPassword)
      .run();

    console.log("已创建默认管理员账户: admin/admin123");
  }

  console.log("数据库初始化完成");
}

/**
 * 执行数据库迁移,处理表结构变更，后续需要根据实际情况设置迁移脚本，待定
 * @param {D1Database} db - D1数据库实例
 * @param {number} currentVersion - 当前数据库版本
 * @param {number} targetVersion - 目标数据库版本
 */
async function migrateDatabase(db, currentVersion, targetVersion) {
  console.log(`开始数据库迁移,当前版本:${currentVersion},目标版本:${targetVersion}`);

  // 按版本号顺序执行迁移
  for (let version = currentVersion + 1; version <= targetVersion; version++) {
    console.log(`执行版本${version}的迁移...`);

    switch (version) {
      case 1:
        // 版本1的迁移脚本(初始版本,跳过)
        break;

      case 2:
        // 示例:添加新字段
        // await db
        //   .prepare(
        //     `ALTER TABLE ${DbTables.PASTES}
        //    ADD COLUMN category TEXT DEFAULT 'default'`
        //   )
        //   .run();
        break;

      // 在这里添加更多版本的迁移脚本
      // case 3:
      //   await db.prepare(`ALTER TABLE ...`).run();
      //   break;

      case 4:
        // 版本4：为API_KEYS表添加挂载权限字段
        try {
          console.log(`为${DbTables.API_KEYS}表添加mount_permission字段...`);

          // 检查字段是否已存在
          const columnInfo = await db.prepare(`PRAGMA table_info(${DbTables.API_KEYS})`).all();

          const mountPermissionExists = columnInfo.results.some((column) => column.name === "mount_permission");

          if (!mountPermissionExists) {
            // 如果字段不存在，添加它
            try {
              await db
                .prepare(
                  `ALTER TABLE ${DbTables.API_KEYS}
                   ADD COLUMN mount_permission BOOLEAN DEFAULT 0`
                )
                .run();
              console.log(`成功添加mount_permission字段到${DbTables.API_KEYS}表`);
            } catch (alterError) {
              console.error(`无法添加mount_permission字段到${DbTables.API_KEYS}表:`, alterError);
              console.log(`将继续执行迁移过程，但请手动检查${DbTables.API_KEYS}表结构`);
              // 不抛出错误，允许迁移继续进行
            }
          } else {
            console.log(`${DbTables.API_KEYS}表已存在mount_permission字段，跳过添加`);
          }
        } catch (error) {
          console.error(`为${DbTables.API_KEYS}表检查mount_permission字段时出错:`, error);
          console.log(`将继续执行迁移过程，但请手动检查${DbTables.API_KEYS}表结构`);
          // 不抛出错误，允许迁移继续进行
        }
        break;

      case 5:
        // 版本5：为API_KEYS表添加basic_path字段
        try {
          console.log(`为${DbTables.API_KEYS}表添加basic_path字段...`);

          // 检查字段是否已存在
          const columnInfo = await db.prepare(`PRAGMA table_info(${DbTables.API_KEYS})`).all();

          const basicPathExists = columnInfo.results.some((column) => column.name === "basic_path");

          if (!basicPathExists) {
            // 如果字段不存在，添加它
            try {
              await db
                .prepare(
                  `ALTER TABLE ${DbTables.API_KEYS}
                   ADD COLUMN basic_path TEXT DEFAULT '/'`
                )
                .run();
              console.log(`成功添加basic_path字段到${DbTables.API_KEYS}表`);
            } catch (alterError) {
              console.error(`无法添加basic_path字段到${DbTables.API_KEYS}表:`, alterError);
              console.log(`将继续执行迁移过程，但请手动检查${DbTables.API_KEYS}表结构`);
              // 不抛出错误，允许迁移继续进行
            }
          } else {
            console.log(`${DbTables.API_KEYS}表已存在basic_path字段，跳过添加`);
          }
        } catch (error) {
          console.error(`为${DbTables.API_KEYS}表检查basic_path字段时出错:`, error);
          console.log(`将继续执行迁移过程，但请手动检查${DbTables.API_KEYS}表结构`);
          // 不抛出错误，允许迁移继续进行
        }
        break;

      case 6:
        // 版本6：为S3_CONFIGS表添加自定义域名和签名时效相关字段
        try {
          console.log(`为${DbTables.S3_CONFIGS}表添加自定义域名相关字段...`);

          // 检查字段是否已存在
          const columnInfo = await db.prepare(`PRAGMA table_info(${DbTables.S3_CONFIGS})`).all();
          const existingColumns = new Set(columnInfo.results.map((col) => col.name));

          // 需要添加的字段
          const fieldsToAdd = [
            { name: "custom_host", sql: "custom_host TEXT" },
            { name: "signature_expires_in", sql: "signature_expires_in INTEGER DEFAULT 3600" },
          ];

          for (const field of fieldsToAdd) {
            if (!existingColumns.has(field.name)) {
              try {
                await db.prepare(`ALTER TABLE ${DbTables.S3_CONFIGS} ADD COLUMN ${field.sql}`).run();
                console.log(`成功添加${field.name}字段到${DbTables.S3_CONFIGS}表`);
              } catch (alterError) {
                console.error(`无法添加${field.name}字段到${DbTables.S3_CONFIGS}表:`, alterError);
                console.log(`将继续执行迁移过程，但请手动检查${DbTables.S3_CONFIGS}表结构`);
                // 不抛出错误，允许迁移继续进行
              }
            } else {
              console.log(`${DbTables.S3_CONFIGS}表已存在${field.name}字段，跳过添加`);
            }
          }
        } catch (error) {
          console.error(`为${DbTables.S3_CONFIGS}表检查自定义域名字段时出错:`, error);
          console.log(`将继续执行迁移过程，但请手动检查${DbTables.S3_CONFIGS}表结构`);
          // 不抛出错误，允许迁移继续进行
        }
        break;

      case 7:
        // 版本7：尝试删除S3_CONFIGS表中的custom_host_signature字段
        // 该字段在技术上是矛盾的：自定义域名要求存储桶公开，公开存储桶不需要签名控制
        try {
          console.log(`尝试删除${DbTables.S3_CONFIGS}表中的custom_host_signature字段...`);

          // 检查字段是否存在
          const columnInfo = await db.prepare(`PRAGMA table_info(${DbTables.S3_CONFIGS})`).all();
          const existingColumns = new Set(columnInfo.results.map((col) => col.name));

          if (existingColumns.has("custom_host_signature")) {
            console.log("检测到custom_host_signature字段，尝试使用现代SQLite语法删除...");

            // 尝试使用现代SQLite语法（3.35.0+支持）
            await db.prepare(`ALTER TABLE ${DbTables.S3_CONFIGS} DROP COLUMN custom_host_signature`).run();

            console.log("custom_host_signature字段删除成功（使用现代SQLite语法）");
          } else {
            console.log("custom_host_signature字段不存在，跳过删除");
          }
        } catch (error) {
          console.log(`现代SQLite语法删除失败，可能是版本不支持: ${error.message}`);
          console.log("该字段将在代码中被忽略，数据库结构保持不变以确保安全");
          // 不抛出错误，允许迁移继续进行
        }
        break;

      case 8:
        // 版本8：为storage_mounts表添加web_proxy和webdav_policy字段
        try {
          console.log(`为${DbTables.STORAGE_MOUNTS}表添加web_proxy和webdav_policy字段...`);

          // 检查web_proxy字段是否存在
          const columnInfo = await db.prepare(`PRAGMA table_info(${DbTables.STORAGE_MOUNTS})`).all();
          const webProxyExists = columnInfo.results.some((column) => column.name === "web_proxy");
          const webdavPolicyExists = columnInfo.results.some((column) => column.name === "webdav_policy");

          if (!webProxyExists) {
            try {
              await db.prepare(`ALTER TABLE ${DbTables.STORAGE_MOUNTS} ADD COLUMN web_proxy BOOLEAN DEFAULT 0`).run();
              console.log(`成功添加web_proxy字段到${DbTables.STORAGE_MOUNTS}表`);
            } catch (alterError) {
              console.error(`无法添加web_proxy字段到${DbTables.STORAGE_MOUNTS}表:`, alterError);
              console.log(`将继续执行迁移过程，但请手动检查${DbTables.STORAGE_MOUNTS}表结构`);
            }
          } else {
            console.log(`${DbTables.STORAGE_MOUNTS}表已存在web_proxy字段，跳过添加`);
          }

          if (!webdavPolicyExists) {
            try {
              await db.prepare(`ALTER TABLE ${DbTables.STORAGE_MOUNTS} ADD COLUMN webdav_policy TEXT DEFAULT '302_redirect'`).run();
              console.log(`成功添加webdav_policy字段到${DbTables.STORAGE_MOUNTS}表`);
            } catch (alterError) {
              console.error(`无法添加webdav_policy字段到${DbTables.STORAGE_MOUNTS}表:`, alterError);
              console.log(`将继续执行迁移过程，但请手动检查${DbTables.STORAGE_MOUNTS}表结构`);
            }
          } else {
            console.log(`${DbTables.STORAGE_MOUNTS}表已存在webdav_policy字段，跳过添加`);
          }
        } catch (error) {
          console.error(`版本8迁移失败:`, error);
          console.log("将继续执行迁移过程，但请手动检查storage_mounts表结构");
        }
        break;

      case 9:
        // 版本9：为files表添加多存储类型支持字段
        try {
          console.log(`为${DbTables.FILES}表添加多存储类型支持字段...`);

          // 检查字段是否已存在
          const columnInfo = await db.prepare(`PRAGMA table_info(${DbTables.FILES})`).all();
          const existingColumns = new Set(columnInfo.results.map((col) => col.name));

          // 需要添加的字段
          const fieldsToAdd = [
            { name: "storage_config_id", sql: "storage_config_id TEXT" },
            { name: "storage_type", sql: "storage_type TEXT" },
            { name: "file_path", sql: "file_path TEXT" },
          ];

          // 添加缺失的字段
          for (const field of fieldsToAdd) {
            if (!existingColumns.has(field.name)) {
              try {
                await db.prepare(`ALTER TABLE ${DbTables.FILES} ADD COLUMN ${field.sql}`).run();
                console.log(`成功添加${field.name}字段到${DbTables.FILES}表`);
              } catch (alterError) {
                console.error(`无法添加${field.name}字段到${DbTables.FILES}表:`, alterError);
                console.log(`将继续执行迁移过程，但请手动检查${DbTables.FILES}表结构`);
              }
            } else {
              console.log(`${DbTables.FILES}表已存在${field.name}字段，跳过添加`);
            }
          }

          // 迁移现有数据：将s3_config_id的数据迁移到新字段
          try {
            console.log("开始迁移现有files表数据...");

            // 更新所有有s3_config_id但没有storage_config_id的记录
            const updateResult = await db
              .prepare(
                `
              UPDATE ${DbTables.FILES}
              SET storage_config_id = s3_config_id, storage_type = 'S3'
              WHERE s3_config_id IS NOT NULL
                AND (storage_config_id IS NULL OR storage_type IS NULL)
            `
              )
              .run();

            console.log(`成功迁移 ${updateResult.changes || 0} 条files记录`);

            // 验证迁移结果
            const unmigratedCount = await db
              .prepare(
                `
              SELECT COUNT(*) as count
              FROM ${DbTables.FILES}
              WHERE s3_config_id IS NOT NULL
                AND (storage_config_id IS NULL OR storage_type IS NULL)
            `
              )
              .first();

            if (unmigratedCount?.count > 0) {
              console.warn(`还有 ${unmigratedCount.count} 条记录未完成迁移`);
              console.log("由于存在未迁移记录，暂不删除s3_config_id字段");
            } else {
              console.log("所有files记录迁移完成");

              // 数据迁移完成后，删除旧的s3_config_id字段
              try {
                console.log("开始删除旧的s3_config_id字段...");

                // 创建新表结构（不包含s3_config_id字段）
                await db
                  .prepare(
                    `
                  CREATE TABLE ${DbTables.FILES}_new (
                    id TEXT PRIMARY KEY,
                    slug TEXT UNIQUE NOT NULL,
                    filename TEXT NOT NULL,

                    -- 存储引用（支持多存储类型）
                    storage_config_id TEXT NOT NULL,
                    storage_type TEXT NOT NULL,
                    storage_path TEXT NOT NULL,
                    file_path TEXT,

                    -- 文件元数据
                    mimetype TEXT NOT NULL,
                    size INTEGER NOT NULL,
                    etag TEXT,

                    -- 分享控制（保持现有功能）
                    remark TEXT,
                    password TEXT,
                    expires_at DATETIME,
                    max_views INTEGER,
                    views INTEGER DEFAULT 0,
                    use_proxy BOOLEAN DEFAULT 1,

                    -- 元数据
                    created_by TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                  )
                `
                  )
                  .run();

                // 复制数据到新表
                await db
                  .prepare(
                    `
                  INSERT INTO ${DbTables.FILES}_new
                  SELECT id, slug, filename, storage_config_id, storage_type, storage_path, file_path,
                         mimetype, size, etag, remark, password, expires_at, max_views, views, use_proxy,
                         created_by, created_at, updated_at
                  FROM ${DbTables.FILES}
                `
                  )
                  .run();

                // 删除旧表
                await db.prepare(`DROP TABLE ${DbTables.FILES}`).run();

                // 重命名新表
                await db.prepare(`ALTER TABLE ${DbTables.FILES}_new RENAME TO ${DbTables.FILES}`).run();

                // 重新创建索引
                await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_slug ON ${DbTables.FILES}(slug)`).run();
                await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_storage_config_id ON ${DbTables.FILES}(storage_config_id)`).run();
                await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_storage_type ON ${DbTables.FILES}(storage_type)`).run();
                await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_file_path ON ${DbTables.FILES}(file_path)`).run();
                await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_created_at ON ${DbTables.FILES}(created_at)`).run();
                await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_expires_at ON ${DbTables.FILES}(expires_at)`).run();

                console.log("成功删除s3_config_id字段并重建表结构");
              } catch (dropError) {
                console.error("删除s3_config_id字段时出错:", dropError);
                console.log("数据迁移已完成，但旧字段删除失败，系统仍可正常工作");
              }
            }
          } catch (migrationError) {
            console.error("迁移files表数据时出错:", migrationError);
            console.log("数据迁移失败，但表结构已更新，请手动检查数据完整性");
          }
        } catch (error) {
          console.error(`版本9迁移失败:`, error);
          console.log("将继续执行迁移过程，但请手动检查files表结构");
        }
        break;

      case 10:
        // 版本10：位标志权限系统迁移
        try {
          console.log("开始位标志权限系统迁移...");

          // 首先备份现有的api_keys表数据
          console.log("备份现有api_keys表数据...");
          const existingKeys = await db.prepare(`SELECT * FROM ${DbTables.API_KEYS}`).all();
          console.log(`找到 ${existingKeys.results?.length || 0} 条现有API密钥记录`);

          // 检查新字段是否已存在
          const columnInfo = await db.prepare(`PRAGMA table_info(${DbTables.API_KEYS})`).all();
          const existingColumns = new Set(columnInfo.results.map((col) => col.name));

          let needsFullMigration = false;

          // 检查是否需要完整迁移
          if (!existingColumns.has("permissions") || !existingColumns.has("role") || !existingColumns.has("is_guest")) {
            needsFullMigration = true;
            console.log("检测到需要完整的表结构迁移");

            // 创建新的api_keys表结构
            await db
              .prepare(
                `
                CREATE TABLE ${DbTables.API_KEYS}_new (
                  id TEXT PRIMARY KEY,
                  name TEXT UNIQUE NOT NULL,
                  key TEXT UNIQUE NOT NULL,
                  permissions INTEGER DEFAULT 0,
                  role TEXT DEFAULT 'GENERAL',
                  basic_path TEXT DEFAULT '/',
                  is_guest BOOLEAN DEFAULT 0,
                  last_used DATETIME,
                  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                  expires_at DATETIME NOT NULL
                )
              `
              )
              .run();

            console.log("新api_keys表结构创建成功");

            // 迁移数据：将布尔权限转换为位标志权限
            if (existingKeys.results && existingKeys.results.length > 0) {
              console.log("开始迁移权限数据...");

              for (const keyRecord of existingKeys.results) {
                let permissions = 0;

                // 转换布尔权限为位标志权限
                if (keyRecord.text_permission === 1) {
                  permissions |= 1; // Permission.TEXT = 1 << 0
                }
                if (keyRecord.file_permission === 1) {
                  permissions |= 2; // Permission.FILE_SHARE = 1 << 1
                }
                if (keyRecord.mount_permission === 1) {
                  // 旧的mount权限映射为完整的挂载页权限
                  permissions |= 256 | 512 | 1024 | 2048 | 4096; // MOUNT_VIEW | MOUNT_UPLOAD | MOUNT_COPY | MOUNT_RENAME | MOUNT_DELETE
                }

                // 确定角色
                let role = "GENERAL";
                if (permissions === 256) {
                  // 只有MOUNT_VIEW权限
                  role = "GUEST";
                } else if (permissions > 0) {
                  role = "GENERAL";
                }

                // 插入转换后的数据
                await db
                  .prepare(
                    `
                    INSERT INTO ${DbTables.API_KEYS}_new
                    (id, name, key, permissions, role, basic_path, is_guest, last_used, created_at, expires_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                  `
                  )
                  .bind(
                    keyRecord.id,
                    keyRecord.name,
                    keyRecord.key,
                    permissions,
                    role,
                    keyRecord.basic_path || "/",
                    role === "GUEST" ? 1 : 0,
                    keyRecord.last_used,
                    keyRecord.created_at,
                    keyRecord.expires_at
                  )
                  .run();
              }

              console.log(`成功迁移 ${existingKeys.results.length} 条API密钥记录`);
            }

            // 删除旧表并重命名新表
            await db.prepare(`DROP TABLE ${DbTables.API_KEYS}`).run();
            await db.prepare(`ALTER TABLE ${DbTables.API_KEYS}_new RENAME TO ${DbTables.API_KEYS}`).run();

            // 重新创建索引
            await db.prepare(`CREATE INDEX IF NOT EXISTS idx_api_keys_key ON ${DbTables.API_KEYS}(key)`).run();
            await db.prepare(`CREATE INDEX IF NOT EXISTS idx_api_keys_role ON ${DbTables.API_KEYS}(role)`).run();
            await db.prepare(`CREATE INDEX IF NOT EXISTS idx_api_keys_permissions ON ${DbTables.API_KEYS}(permissions)`).run();
            await db.prepare(`CREATE INDEX IF NOT EXISTS idx_api_keys_expires_at ON ${DbTables.API_KEYS}(expires_at)`).run();

            console.log("api_keys表结构迁移完成");
          } else {
            console.log("api_keys表已包含新字段，跳过结构迁移");
          }

          // 验证迁移结果
          const migratedKeys = await db.prepare(`SELECT COUNT(*) as count FROM ${DbTables.API_KEYS}`).first();
          console.log(`迁移后api_keys表包含 ${migratedKeys?.count || 0} 条记录`);

          // 显示权限迁移统计
          const permissionStats = await db
            .prepare(
              `
              SELECT
                role,
                COUNT(*) as count,
                AVG(permissions) as avg_permissions
              FROM ${DbTables.API_KEYS}
              GROUP BY role
            `
            )
            .all();

          console.log("权限迁移统计:");
          for (const stat of permissionStats.results || []) {
            console.log(`  ${stat.role}: ${stat.count} 个用户, 平均权限值: ${Math.round(stat.avg_permissions)}`);
          }

          console.log("位标志权限系统迁移完成");
        } catch (error) {
          console.error(`版本10迁移失败:`, error);
          console.log("位标志权限系统迁移失败，请手动检查api_keys表结构");
        }
        break;

      case 11:
        // 版本11：为storage_mounts表添加代理签名相关字段
        try {
          console.log(`为${DbTables.STORAGE_MOUNTS}表添加代理签名字段...`);

          // 检查字段是否已存在
          const columnInfo = await db.prepare(`PRAGMA table_info(${DbTables.STORAGE_MOUNTS})`).all();
          const existingColumns = new Set(columnInfo.results.map((col) => col.name));

          // 添加enable_sign字段
          if (!existingColumns.has("enable_sign")) {
            try {
              await db.prepare(`ALTER TABLE ${DbTables.STORAGE_MOUNTS} ADD COLUMN enable_sign BOOLEAN DEFAULT 0`).run();
              console.log(`成功添加enable_sign字段到${DbTables.STORAGE_MOUNTS}表`);
            } catch (alterError) {
              console.error(`无法添加enable_sign字段到${DbTables.STORAGE_MOUNTS}表:`, alterError);
              console.log(`将继续执行迁移过程，但请手动检查${DbTables.STORAGE_MOUNTS}表结构`);
            }
          } else {
            console.log(`${DbTables.STORAGE_MOUNTS}表已存在enable_sign字段，跳过添加`);
          }

          // 添加sign_expires字段
          if (!existingColumns.has("sign_expires")) {
            try {
              await db.prepare(`ALTER TABLE ${DbTables.STORAGE_MOUNTS} ADD COLUMN sign_expires INTEGER DEFAULT NULL`).run();
              console.log(`成功添加sign_expires字段到${DbTables.STORAGE_MOUNTS}表`);
            } catch (alterError) {
              console.error(`无法添加sign_expires字段到${DbTables.STORAGE_MOUNTS}表:`, alterError);
              console.log(`将继续执行迁移过程，但请手动检查${DbTables.STORAGE_MOUNTS}表结构`);
            }
          } else {
            console.log(`${DbTables.STORAGE_MOUNTS}表已存在sign_expires字段，跳过添加`);
          }

          // 添加全局代理签名设置
          const globalSettings = [
            {
              key: "proxy_sign_all",
              value: "true",
              description: "签名所有：开启后所有代理访问都需要签名",
            },
            {
              key: "proxy_sign_expires",
              value: "0",
              description: "全局签名过期时间（秒），0表示永不过期",
            },
          ];

          for (const setting of globalSettings) {
            try {
              // 检查设置是否已存在
              const existingSetting = await db.prepare(`SELECT key FROM ${DbTables.SYSTEM_SETTINGS} WHERE key = ?`).bind(setting.key).first();

              if (!existingSetting) {
                await db
                  .prepare(
                    `INSERT INTO ${DbTables.SYSTEM_SETTINGS} (key, value, description, updated_at)
                     VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
                  )
                  .bind(setting.key, setting.value, setting.description)
                  .run();
                console.log(`成功添加系统设置: ${setting.key}`);
              } else {
                console.log(`系统设置 ${setting.key} 已存在，跳过添加`);
              }
            } catch (settingError) {
              console.error(`添加系统设置 ${setting.key} 失败:`, settingError);
            }
          }

          console.log("代理签名字段和设置添加完成");
        } catch (error) {
          console.error(`版本11迁移失败:`, error);
          console.log("代理签名功能迁移失败，请手动检查storage_mounts表结构和系统设置");
        }
        break;

      case 12:
        // 版本12：系统设置架构重构 - 添加类型化和分组支持
        try {
          console.log("开始系统设置架构重构迁移...");

          // 检查system_settings表的当前字段
          const columnInfo = await db.prepare(`PRAGMA table_info(${DbTables.SYSTEM_SETTINGS})`).all();
          const existingColumns = new Set(columnInfo.results.map((col) => col.name));

          // 需要添加的新字段
          const newFields = [
            { name: "type", sql: "ALTER TABLE system_settings ADD COLUMN type TEXT DEFAULT 'text'" },
            { name: "group_id", sql: "ALTER TABLE system_settings ADD COLUMN group_id INTEGER DEFAULT 1" },
            { name: "options", sql: "ALTER TABLE system_settings ADD COLUMN options TEXT" },
            { name: "sort_order", sql: "ALTER TABLE system_settings ADD COLUMN sort_order INTEGER DEFAULT 0" },
            { name: "flags", sql: "ALTER TABLE system_settings ADD COLUMN flags INTEGER DEFAULT 0" },
          ];

          // 添加缺少的字段
          for (const field of newFields) {
            if (!existingColumns.has(field.name)) {
              try {
                await db.prepare(field.sql).run();
                console.log(`成功添加字段: ${field.name}`);
              } catch (alterError) {
                console.error(`添加字段 ${field.name} 失败:`, alterError);
                console.log(`将继续执行迁移过程，但请手动检查system_settings表结构`);
              }
            } else {
              console.log(`字段 ${field.name} 已存在，跳过添加`);
            }
          }

          console.log("系统设置表结构扩展完成");

          // 更新现有设置项的元数据
          console.log("开始更新现有设置项的分组和类型信息...");

          const settingUpdates = [
            // 全局设置组 (GLOBAL = 1)
            {
              key: "max_upload_size",
              type: "number",
              group_id: 1,
              description: "单次上传文件的最大大小限制(MB)，建议根据服务器性能设置。",
              options: null,
              sort_order: 1,
              flags: 0,
            },
            {
              key: "proxy_sign_all",
              type: "bool",
              group_id: 1,
              description: "开启后所有代理访问都需要签名验证，提升安全性。",
              options: null,
              sort_order: 2,
              flags: 0,
            },
            {
              key: "proxy_sign_expires",
              type: "number",
              group_id: 1,
              description: "代理签名的过期时间（秒），0表示永不过期。",
              options: null,
              sort_order: 3,
              flags: 0,
            },
            // WebDAV设置组 (WEBDAV = 3)
            {
              key: "webdav_upload_mode",
              type: "select",
              group_id: 3,
              description: "WebDAV客户端的上传模式选择。",
              options: JSON.stringify([
                { value: "direct", label: "直接上传" },
                { value: "multipart", label: "分片上传" },
              ]),
              sort_order: 1,
              flags: 0,
            },
            // 系统内部设置 (SYSTEM = 99)
            {
              key: "db_initialized",
              type: "bool",
              group_id: 99,
              description: "数据库初始化状态标记，系统内部使用。",
              options: null,
              sort_order: 1,
              flags: 2,
            },
            {
              key: "schema_version",
              type: "number",
              group_id: 99,
              description: "数据库架构版本号，系统内部使用。",
              options: null,
              sort_order: 2,
              flags: 2,
            },
          ];

          for (const update of settingUpdates) {
            try {
              // 检查设置项是否存在
              const existingSetting = await db.prepare(`SELECT key FROM ${DbTables.SYSTEM_SETTINGS} WHERE key = ?`).bind(update.key).first();

              if (existingSetting) {
                // 更新现有设置项的元数据
                await db
                  .prepare(
                    `
                    UPDATE ${DbTables.SYSTEM_SETTINGS}
                    SET type = ?, group_id = ?, description = ?, options = ?, sort_order = ?, flags = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE key = ?
                  `
                  )
                  .bind(update.type, update.group_id, update.description, update.options, update.sort_order, update.flags, update.key)
                  .run();
                console.log(`成功更新设置项元数据: ${update.key}`);
              } else {
                console.log(`设置项 ${update.key} 不存在，跳过更新`);
              }
            } catch (updateError) {
              console.error(`更新设置项 ${update.key} 失败:`, updateError);
            }
          }

          console.log("现有设置项元数据更新完成");
        } catch (error) {
          console.error(`版本12迁移失败:`, error);
          console.log("系统设置架构重构迁移失败，请手动检查system_settings表结构");
        }
        break;

      case 13:
        // 版本13：添加预览设置默认值
        try {
          console.log("开始添加预览设置默认值...");

          // 预览设置的默认值
          const previewSettings = [
            {
              key: "preview_text_types",
              value:
                "txt,htm,html,xml,java,properties,sql,js,md,json,conf,ini,vue,php,py,bat,yml,go,sh,c,cpp,h,hpp,tsx,vtt,srt,ass,rs,lrc,dockerfile,makefile,gitignore,license,readme",
              description: "支持预览的文本文件扩展名，用逗号分隔",
              type: "textarea",
              group_id: 2,
              sort_order: 1,
              flags: 0,
            },
            {
              key: "preview_audio_types",
              value: "mp3,flac,ogg,m4a,wav,opus,wma",
              description: "支持预览的音频文件扩展名，用逗号分隔",
              type: "textarea",
              group_id: 2,
              sort_order: 2,
              flags: 0,
            },
            {
              key: "preview_video_types",
              value: "mp4,mkv,avi,mov,rmvb,webm,flv,m3u8,ts,m2ts",
              description: "支持预览的视频文件扩展名，用逗号分隔",
              type: "textarea",
              group_id: 2,
              sort_order: 3,
              flags: 0,
            },
            {
              key: "preview_image_types",
              value: "jpg,tiff,jpeg,png,gif,bmp,svg,ico,swf,webp,avif",
              description: "支持预览的图片文件扩展名，用逗号分隔",
              type: "textarea",
              group_id: 2,
              sort_order: 4,
              flags: 0,
            },
            {
              key: "preview_office_types",
              value: "doc,docx,xls,xlsx,ppt,pptx,rtf",
              description: "支持预览的Office文档扩展名（需要在线转换），用逗号分隔",
              type: "textarea",
              group_id: 2,
              sort_order: 5,
              flags: 0,
            },
            {
              key: "preview_document_types",
              value: "pdf",
              description: "支持预览的文档文件扩展名（可直接预览），用逗号分隔",
              type: "textarea",
              group_id: 2,
              sort_order: 6,
              flags: 0,
            },
          ];

          // 插入预览设置
          for (const setting of previewSettings) {
            try {
              // 检查设置是否已存在
              const existingSetting = await db.prepare(`SELECT key FROM ${DbTables.SYSTEM_SETTINGS} WHERE key = ?`).bind(setting.key).first();

              if (!existingSetting) {
                await db
                  .prepare(
                    `INSERT INTO ${DbTables.SYSTEM_SETTINGS} (key, value, description, type, group_id, sort_order, flags, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
                  )
                  .bind(setting.key, setting.value, setting.description, setting.type, setting.group_id, setting.sort_order, setting.flags)
                  .run();
                console.log(`成功添加预览设置: ${setting.key}`);
              } else {
                console.log(`预览设置 ${setting.key} 已存在，跳过添加`);
              }
            } catch (settingError) {
              console.error(`添加预览设置 ${setting.key} 失败:`, settingError);
            }
          }

          console.log("预览设置默认值添加完成");
        } catch (error) {
          console.error(`版本13迁移失败:`, error);
          console.log("预览设置迁移失败，请手动检查system_settings表");
        }
        break;

      case 14:
        // 版本14：修改files表的use_proxy默认值为0（不使用代理）
        try {
          console.log("开始修改files表的use_proxy默认值...");

          // 检查files表是否存在
          const filesTableExists = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='${DbTables.FILES}'`).first();

          if (filesTableExists) {
            // SQLite不支持直接修改列的默认值，需要重建表
            console.log("创建新的files表结构（use_proxy默认值为0）...");

            // 1. 创建新表结构
            await db
              .prepare(
                `
              CREATE TABLE ${DbTables.FILES}_new (
                id TEXT PRIMARY KEY,
                slug TEXT UNIQUE NOT NULL,
                filename TEXT NOT NULL,

                -- 存储引用（支持多存储类型）
                storage_config_id TEXT NOT NULL,
                storage_type TEXT NOT NULL,
                storage_path TEXT NOT NULL,
                file_path TEXT,

                -- 文件元数据
                mimetype TEXT NOT NULL,
                size INTEGER NOT NULL,
                etag TEXT,

                -- 分享控制（保持现有功能）
                remark TEXT,
                password TEXT,
                expires_at DATETIME,
                max_views INTEGER,
                views INTEGER DEFAULT 0,
                use_proxy BOOLEAN DEFAULT 0,  -- 修改默认值为0

                -- 元数据
                created_by TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
              )
            `
              )
              .run();

            // 2. 复制数据到新表
            console.log("复制数据到新表...");
            await db
              .prepare(
                `
              INSERT INTO ${DbTables.FILES}_new
              SELECT * FROM ${DbTables.FILES}
            `
              )
              .run();

            // 3. 删除旧表
            console.log("删除旧表...");
            await db.prepare(`DROP TABLE ${DbTables.FILES}`).run();

            // 4. 重命名新表
            console.log("重命名新表...");
            await db.prepare(`ALTER TABLE ${DbTables.FILES}_new RENAME TO ${DbTables.FILES}`).run();

            // 5. 重建索引
            console.log("重建索引...");
            await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_slug ON ${DbTables.FILES}(slug)`).run();
            await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_created_at ON ${DbTables.FILES}(created_at DESC)`).run();
            await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_created_by ON ${DbTables.FILES}(created_by)`).run();
            await db.prepare(`CREATE INDEX IF NOT EXISTS idx_files_storage_config ON ${DbTables.FILES}(storage_config_id)`).run();

            console.log("files表use_proxy默认值修改完成");
          } else {
            console.log("files表不存在，跳过迁移");
          }

          // 添加全局默认代理设置
          console.log("添加全局默认代理设置...");
          const defaultUseProxySetting = await db.prepare(`SELECT key FROM ${DbTables.SYSTEM_SETTINGS} WHERE key = 'default_use_proxy'`).first();

          if (!defaultUseProxySetting) {
            await db
              .prepare(
                `
              INSERT INTO ${DbTables.SYSTEM_SETTINGS} (key, value, description, type, group_id, options, sort_order, flags)
              VALUES ('default_use_proxy', 'false', '文件管理的默认代理设置。启用后新上传文件默认使用Worker代理，禁用后默认使用直链。', 'bool', 1, NULL, 4, 0)
            `
              )
              .run();
            console.log("全局默认代理设置添加完成");
          } else {
            console.log("全局默认代理设置已存在，跳过添加");
          }
        } catch (error) {
          console.error(`版本14迁移失败:`, error);
          console.log("use_proxy默认值修改失败，请手动检查files表结构");
        }
        break;

      case 15:
        // 版本15：添加文件命名策略系统设置
        try {
          console.log("开始添加文件命名策略系统设置...");

          // 检查设置是否已存在
          const existingSetting = await db.prepare(`SELECT key FROM ${DbTables.SYSTEM_SETTINGS} WHERE key = ?`).bind("file_naming_strategy").first();

          if (!existingSetting) {
            // 添加文件命名策略设置
            const options = JSON.stringify([
              { value: "overwrite", label: "覆盖模式" },
              { value: "random_suffix", label: "随机后缀模式" },
            ]);

            await db
              .prepare(
                `INSERT INTO ${DbTables.SYSTEM_SETTINGS} (key, value, description, type, group_id, options, sort_order, flags, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
              )
              .bind(
                "file_naming_strategy",
                "overwrite",
                "文件命名策略：覆盖模式使用原始文件名（可能冲突），随机后缀模式避免冲突且保持文件名可读性。",
                "select",
                1, // SETTING_GROUPS.GLOBAL
                options,
                4,
                0 // SETTING_FLAGS.PUBLIC
              )
              .run();

            console.log("成功添加文件命名策略设置");
          } else {
            console.log("文件命名策略设置已存在，跳过添加");
          }

          console.log("文件命名策略设置添加完成");
        } catch (error) {
          console.error(`版本15迁移失败:`, error);
          console.log("文件命名策略设置迁移失败，请手动检查system_settings表");
        }
        break;
    }

    // 记录迁移历史
    const now = new Date().toISOString();
    const migrationKey = `migration_${version}`;

    // 检查迁移记录是否已存在
    const existingMigration = await db.prepare(`SELECT key FROM ${DbTables.SYSTEM_SETTINGS} WHERE key = ?`).bind(migrationKey).first();

    if (!existingMigration) {
      // 根据版本决定使用哪种INSERT语句
      if (version >= 12) {
        // 版本12及以后：使用新的表结构（包含type, group_id等字段）
        await db
          .prepare(
            `INSERT INTO ${DbTables.SYSTEM_SETTINGS} (key, value, description, type, group_id, sort_order, flags, updated_at)
           VALUES (?, ?, ?, 'string', 99, 999, 1, ?)`
          )
          .bind(migrationKey, "completed", `Version ${version} migration completed`, now)
          .run();
      } else {
        // 版本12之前：使用旧的表结构（只有基本字段）
        await db
          .prepare(
            `INSERT INTO ${DbTables.SYSTEM_SETTINGS} (key, value, description, updated_at)
           VALUES (?, ?, ?, ?)`
          )
          .bind(migrationKey, "completed", `Version ${version} migration completed`, now)
          .run();
      }
    } else {
      console.log(`迁移记录 ${migrationKey} 已存在，跳过插入`);
    }
  }

  console.log("数据库迁移完成");

  // 清理旧的迁移记录，只保留最近的2个版本
  await cleanupOldMigrationRecords(db, targetVersion);
}

/**
 * 清理旧的迁移记录，只保留最近的2个版本
 * @param {D1Database} db - D1数据库实例
 * @param {number} currentVersion - 当前版本
 */
async function cleanupOldMigrationRecords(db, currentVersion) {
  try {
    console.log("开始清理旧的迁移记录...");

    // 保留最近的5个版本，删除更早的迁移记录
    const keepVersions = 5;
    const deleteBeforeVersion = currentVersion - keepVersions;

    if (deleteBeforeVersion > 0) {
      // 构建要删除的迁移记录键名列表
      const keysToDelete = [];
      for (let version = 1; version <= deleteBeforeVersion; version++) {
        keysToDelete.push(`migration_${version}`);
      }

      if (keysToDelete.length > 0) {
        // 批量删除旧的迁移记录
        const placeholders = keysToDelete.map(() => "?").join(",");
        const deleteQuery = `DELETE FROM ${DbTables.SYSTEM_SETTINGS} WHERE key IN (${placeholders})`;

        const result = await db
          .prepare(deleteQuery)
          .bind(...keysToDelete)
          .run();

        console.log(`成功清理 ${result.changes || 0} 个旧的迁移记录 (版本 1-${deleteBeforeVersion})`);
        console.log(`保留的迁移记录: migration_${deleteBeforeVersion + 1} 到 migration_${currentVersion}`);
      } else {
        console.log("没有需要清理的旧迁移记录");
      }
    } else {
      console.log("当前版本较低，跳过迁移记录清理");
    }
  } catch (error) {
    console.error("清理旧迁移记录时出错:", error);
    // 不抛出错误，清理失败不应该影响系统正常运行
  }
}

/**
 * 检查数据库是否需要初始化，并在需要时执行初始化
 * 通过检查系统设置表中是否存在特定标记来判断
 * @param {D1Database} db - D1数据库实例
 * @returns {Promise<boolean>} 是否执行了初始化操作
 */
export async function checkAndInitDatabase(db) {
  try {
    console.log("检查数据库状态...");

    // 获取所有现有表
    const existingTables = await db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all();
    const tableSet = new Set(existingTables.results.map((table) => table.name));

    // 检查每个表是否存在，不存在则创建
    let needsTablesCreation = false;

    // 检查pastes表
    if (!tableSet.has(DbTables.PASTES)) {
      console.log(`${DbTables.PASTES}表不存在，需要创建`);
      needsTablesCreation = true;
    }

    // 检查paste_passwords表
    if (!tableSet.has(DbTables.PASTE_PASSWORDS)) {
      console.log(`${DbTables.PASTE_PASSWORDS}表不存在，需要创建`);
      needsTablesCreation = true;
    }

    // 检查admins表
    if (!tableSet.has(DbTables.ADMINS)) {
      console.log(`${DbTables.ADMINS}表不存在，需要创建`);
      needsTablesCreation = true;
    }

    // 检查admin_tokens表
    if (!tableSet.has(DbTables.ADMIN_TOKENS)) {
      console.log(`${DbTables.ADMIN_TOKENS}表不存在，需要创建`);
      needsTablesCreation = true;
    }

    // 检查api_keys表
    if (!tableSet.has(DbTables.API_KEYS)) {
      console.log(`${DbTables.API_KEYS}表不存在，需要创建`);
      needsTablesCreation = true;
    }

    // 检查s3_configs表
    if (!tableSet.has(DbTables.S3_CONFIGS)) {
      console.log(`${DbTables.S3_CONFIGS}表不存在，需要创建`);
      needsTablesCreation = true;
    }

    // 检查files表
    if (!tableSet.has(DbTables.FILES)) {
      console.log(`${DbTables.FILES}表不存在，需要创建`);
      needsTablesCreation = true;
    }

    // 检查file_passwords表
    if (!tableSet.has(DbTables.FILE_PASSWORDS)) {
      console.log(`${DbTables.FILE_PASSWORDS}表不存在，需要创建`);
      needsTablesCreation = true;
    }

    // 检查system_settings表
    if (!tableSet.has(DbTables.SYSTEM_SETTINGS)) {
      console.log(`${DbTables.SYSTEM_SETTINGS}表不存在，需要创建`);
      needsTablesCreation = true;
    }

    // 检查storage_mounts表
    if (!tableSet.has(DbTables.STORAGE_MOUNTS)) {
      console.log(`${DbTables.STORAGE_MOUNTS}表不存在，需要创建`);
      needsTablesCreation = true;
    }

    // 如果有表不存在，执行表初始化
    if (needsTablesCreation) {
      console.log("检测到缺少表，执行表创建...");
      await initDatabase(db);
    }

    // 检查当前schema版本
    let currentVersion = 0;

    if (tableSet.has(DbTables.SYSTEM_SETTINGS)) {
      const schemaVersion = await db.prepare(`SELECT value FROM ${DbTables.SYSTEM_SETTINGS} WHERE key='schema_version'`).first();
      currentVersion = schemaVersion ? parseInt(schemaVersion.value) : 0;
    }

    // 如果要添加新表或修改现有表，请递增目标版本，修改后启动时自动更新数据库
    const targetVersion = 15; // 目标schema版本,每次修改表结构时递增

    if (currentVersion < targetVersion) {
      console.log(`需要更新数据库结构，当前版本:${currentVersion}，目标版本:${targetVersion}`);

      if (currentVersion === 0 && !needsTablesCreation) {
        // 如果版本为0但表已存在，表示是旧数据库，执行完整初始化确保所有表创建
        await initDatabase(db);
      } else if (currentVersion > 0) {
        // 执行迁移脚本
        await migrateDatabase(db, currentVersion, targetVersion);
      }

      // 更新schema版本
      const now = new Date().toISOString();
      if (tableSet.has(DbTables.SYSTEM_SETTINGS)) {
        const existingVersion = await db.prepare(`SELECT value FROM ${DbTables.SYSTEM_SETTINGS} WHERE key='schema_version'`).first();
        if (existingVersion) {
          await db
            .prepare(
              `UPDATE ${DbTables.SYSTEM_SETTINGS} 
               SET value = ?, updated_at = ?
               WHERE key = 'schema_version'`
            )
            .bind(targetVersion.toString(), now)
            .run();
        } else {
          await db
            .prepare(
              `INSERT INTO ${DbTables.SYSTEM_SETTINGS} (key, value, description, type, group_id, sort_order, flags, updated_at)
               VALUES ('schema_version', ?, '数据库Schema版本号', 'string', 99, 1, 1, ?)`
            )
            .bind(targetVersion.toString(), now)
            .run();
        }
      }
    }

    // 检查初始化标记
    if (tableSet.has(DbTables.SYSTEM_SETTINGS)) {
      const initFlag = await db.prepare(`SELECT value FROM ${DbTables.SYSTEM_SETTINGS} WHERE key='db_initialized'`).first();

      if (!initFlag) {
        // 没有初始化标记，设置标记
        const now = new Date().toISOString();
        try {
          await db
            .prepare(
              `INSERT INTO ${DbTables.SYSTEM_SETTINGS} (key, value, description, type, group_id, sort_order, flags, updated_at)
               VALUES ('db_initialized', ?, '数据库初始化完成标记', 'bool', 99, 2, 1, ?)`
            )
            .bind("true", now)
            .run();
          console.log("设置数据库初始化标记");
        } catch (insertError) {
          // 如果插入失败（可能是因为记录已存在），检查是否确实存在
          const recheckFlag = await db.prepare(`SELECT value FROM ${DbTables.SYSTEM_SETTINGS} WHERE key='db_initialized'`).first();
          if (recheckFlag) {
            console.log("数据库初始化标记已存在，跳过设置");
          } else {
            console.error("设置数据库初始化标记失败:", insertError);
            throw insertError;
          }
        }
      } else {
        console.log("数据库已初始化，跳过初始化标记设置");
      }
    }

    return needsTablesCreation || currentVersion < targetVersion; // 如果创建了表或需要更新，说明执行了初始化
  } catch (error) {
    // 如果出错（例如表不存在），则执行初始化
    console.error("检查数据库状态出错，执行初始化:", error);
    await initDatabase(db);
    return true;
  }
}
