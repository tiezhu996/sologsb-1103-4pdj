# ---------- 构建阶段：node:20-alpine 安装依赖并产出静态产物 ----------
FROM node:20-alpine AS builder

WORKDIR /app

# 先复制依赖清单，充分利用镜像层缓存
COPY frontend/package.json frontend/package-lock.json ./

# 使用 npm ci 保证依赖可复现；无 lock 文件时回退到 npm install
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi

# 复制源码与构建配置：npm run build 内含 vue-tsc 类型检查，任何类型错误都会中断镜像构建
COPY frontend/tsconfig.json frontend/vite.config.ts frontend/index.html ./
COPY frontend/public ./public
COPY frontend/src ./src

RUN npm run build

# ---------- 运行阶段：nginx:alpine 托管构建产物 ----------
FROM nginx:alpine AS runner

# SPA fallback + gzip 配置
COPY nginx.conf /etc/nginx/conf.d/default.conf

# 覆盖默认站点产物
RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/dist /usr/share/nginx/html

# 静态产物放开读权限，避免宿主机文件权限导致 nginx 返回 403
RUN chmod -R a+rX /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
