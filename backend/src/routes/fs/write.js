import { ValidationError } from "../../http/errors.js";
import { MountManager } from "../../storage/managers/MountManager.js";
import { FileSystem } from "../../storage/fs/FileSystem.js";
import { getEncryptionSecret } from "../../utils/environmentUtils.js";
import { getQueryBool, getQueryInt, jsonOk } from "../../utils/common.js";
import { usePolicy } from "../../security/policies/policies.js";

const parseJsonBody = async (c, next) => {
  const body = await c.req.json();
  c.set("jsonBody", body);
  await next();
};

const parseFormData = async (c, next) => {
  const formData = await c.req.formData();
  c.set("formData", formData);
  await next();
};

const jsonPathResolver = (field = "path") => (c) => c.get("jsonBody")?.[field];

const formPathResolver = (field = "path") => (c) => c.get("formData")?.get(field);

export const registerWriteRoutes = (router, helpers) => {
  const { getServiceParams } = helpers;

  router.post("/api/fs/mkdir", parseJsonBody, usePolicy("fs.upload", { pathResolver: jsonPathResolver() }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const body = c.get("jsonBody");
    const path = body.path;

    if (!path) {
      throw new ValidationError("请提供目录路径");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    await fileSystem.createDirectory(path, userIdOrInfo, userType);

    return jsonOk(c, undefined, "目录创建成功");
  });

  router.post("/api/fs/upload", parseFormData, usePolicy("fs.upload", { pathResolver: formPathResolver() }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const formData = c.get("formData");
    const file = formData.get("file");
    const path = formData.get("path");
    const uploadId = formData.get("upload_id") || null;

    if (!file || !path) {
      throw new ValidationError("请提供文件和路径");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);

    // 统一走 FileSystem.uploadFile 入口，内部根据类型决定是否流式
    const streamOrFile = typeof file.stream === "function" ? file.stream() : file;
    const result = await fileSystem.uploadFile(path, /** @type {any} */ (streamOrFile), userIdOrInfo, userType, {
      filename: file.name,
      contentType: file.type,
      contentLength: typeof file.size === "number" ? file.size : 0,
      uploadId: uploadId || undefined,
    });

    return jsonOk(c, result, "文件上传成功");
  });

  router.post("/api/fs/update", parseJsonBody, usePolicy("fs.upload", { pathResolver: jsonPathResolver() }), async (c) => {
    const db = c.env.DB;
    const userInfo = c.get("userInfo");
    const { userIdOrInfo, userType } = getServiceParams(userInfo);
    const encryptionSecret = getEncryptionSecret(c);
    const repositoryFactory = c.get("repos");
    const body = c.get("jsonBody");
    const path = body.path;
    const content = body.content;

    if (!path || content === undefined) {
      throw new ValidationError("请提供文件路径和内容");
    }

    const mountManager = new MountManager(db, encryptionSecret, repositoryFactory);
    const fileSystem = new FileSystem(mountManager);
    const result = await fileSystem.updateFile(path, content, userIdOrInfo, userType);

    return jsonOk(c, result, "文件更新成功");
  });
};
