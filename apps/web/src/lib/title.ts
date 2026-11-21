const labels = {
  "Sign in": "登录",
  "Create account": "创建账号",
  "Reset password": "重置密码",
  "Set a new password": "设置新密码",
  Invitation: "邀请",
  "Dev mailbox": "开发邮箱",
  Reader: "阅读器",
  Series: "系列",
  Projects: "项目",
  "New project": "新建项目",
  "Channel profiles": "频道配置",
  Usage: "用量",
  Experts: "专家",
  "Agent access": "智能体访问",
  "Connect an agent": "连接智能体",
  Admin: "管理",
  Account: "账号",
  Overview: "概览",
  Story: "故事",
  Cast: "角色",
  Character: "角色详情",
  World: "世界设定",
  Location: "场景",
  Prop: "道具",
  "Story bible": "故事设定集",
  "Prompt lab": "提示词实验室",
  "Reference board": "参考看板",
  "Story timeline": "故事时间线",
  Chapters: "章节",
  Chapter: "章节详情",
  Pages: "页面",
  Shots: "镜头",
  Strip: "长条漫画",
  Storyboard: "分镜",
  "Page editor": "页面编辑器",
  "Shot editor": "镜头编辑器",
  Read: "阅读",
  Agent: "智能体",
  Comments: "评论",
  Health: "项目检查",
  Generation: "生成任务",
  Job: "任务详情",
  Narration: "旁白",
  "Narration QA": "旁白质检",
  Timing: "时间轴",
  Repurpose: "内容再利用",
  "YouTube stats": "YouTube 数据",
  "Describe image": "图片描述",
  Assets: "素材",
  Exports: "导出",
  Cost: "费用",
  Settings: "设置",
};

export function pageLabel(label: string, format?: string) {
  if (label === "Pages") {
    if (format === "film") return labels.Shots;
    if (format === "vertical") return labels.Strip;
  }
  if (label === "Page editor" && format === "film") return labels["Shot editor"];
  return Object.hasOwn(labels, label) ? labels[label as keyof typeof labels] : label;
}

/**
 * Tab title for a matched route. The project name is appended so two tabs open on different projects are told
 * apart, and film projects get the same wording the sidebar uses.
 */
export function documentTitle(label: string | undefined, project?: { title: string; format?: string } | null) {
  const page = label ? pageLabel(label, project?.format) : undefined;
  return [page, project?.title, "OpenManga"].filter(Boolean).join(" · ");
}
