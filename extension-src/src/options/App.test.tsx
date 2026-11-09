import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import App from "./App.tsx";
import { LegacyImportSection } from "./LegacyImportSection.tsx";
import { MessageService } from "../shared/message.ts";
import type { UserProfile } from "../shared/types.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const makeProfile = (name: string): UserProfile => ({ personal: { name }, education: [], experience: [], projects: [], awards: [], customInformation: [], skills: [], certifications: [] });

function text(renderer: TestRenderer.ReactTestRenderer): string {
  return renderer.root.findAll(node => typeof node.type === "string").flatMap(node => node.children).filter(child => typeof child === "string").join(" ");
}

async function setup() {
  const originalChrome = globalThis.chrome;
  const originalWindow = globalThis.window;
  const originalSend = MessageService.sendMessage;
  let listener: ((changes: Record<string, chrome.storage.StorageChange>, area: string) => void) | undefined;
  let activeId = "profile-a";
  let profileFailure = false;
  let getProfileCount = 0;
  let saveCount = 0;
  const profiles: Record<string, UserProfile> = { "profile-a": makeProfile("资料 A"), "profile-b": makeProfile("资料 B") };
  globalThis.window = { location: { search: "" }, setTimeout, clearTimeout } as unknown as Window & typeof globalThis;
  globalThis.chrome = { storage: { onChanged: { addListener(fn) { listener = fn; }, removeListener() {} } }, runtime: {} } as unknown as typeof chrome;
  MessageService.sendMessage = (async message => {
    if (message.type === "GET_RESUME_PROFILES") return { success: true, data: { activeProfileId: activeId, profiles: [{ id: "profile-a", name: "A", updatedAt: "1" }, { id: "profile-b", name: "B", updatedAt: "2" }] } };
    if (message.type === "GET_ACTIVE_RESUME_CONTEXT") { getProfileCount++; return profileFailure ? { success: false, error: "读取失败" } : { success: true, data: { activeProfileId: activeId, profiles: [{ id: "profile-a", name: "A", updatedAt: "1" }, { id: "profile-b", name: "B", updatedAt: "2" }], profile: profiles[activeId], revision: activeId } }; }
    if (message.type === "GET_USER_PROFILE") { getProfileCount++; return profileFailure ? { success: false, error: "读取失败" } : { success: true, data: profiles[activeId] }; }
    if (message.type === "SAVE_USER_PROFILE") { saveCount++; return { success: true }; }
    return { success: true };
  }) as typeof MessageService.sendMessage;
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => { renderer = TestRenderer.create(<App />); });
  return {
    renderer,
    fire(changes: Record<string, chrome.storage.StorageChange>, area = "local") { return act(async () => { listener?.(changes, area); await Promise.resolve(); await Promise.resolve(); }); },
    setActive(id: string) { activeId = id; },
    failProfile(value: boolean) { profileFailure = value; },
    getProfileCount: () => getProfileCount,
    saveCount: () => saveCount,
    async cleanup() { await act(async () => { renderer.unmount(); }); MessageService.sendMessage = originalSend; globalThis.chrome = originalChrome; globalThis.window = originalWindow; },
  };
}

function nameInput(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findByProps({ placeholder: "请输入姓名" });
}

function button(renderer: TestRenderer.ReactTestRenderer, label: string) {
  return renderer.root.findAllByType("button").find(item => item.children.join("") === label);
}

test("options 仅响应 local resumeProfileLibrary；dirty 时保留输入并等待用户选择", async () => {
  const env = await setup();
  try {
    assert.ok(env.getProfileCount() === 1);
    await env.fire({ userProfile: { oldValue: {}, newValue: {} } });
    await env.fire({ resumeProfileLibrary: { oldValue: {}, newValue: {} } }, "sync");
    assert.equal(env.getProfileCount(), 1);
    await act(async () => { nameInput(env.renderer).props.onChange({ target: { value: "本地草稿" } }); });
    env.setActive("profile-b");
    await env.fire({ resumeProfileLibrary: { oldValue: {}, newValue: {} } });
    assert.equal(nameInput(env.renderer).props.value, "本地草稿");
    assert.match(text(env.renderer), /重新加载/);
    assert.match(text(env.renderer), /保留本地修改/);
    assert.equal(env.getProfileCount(), 2);
  } finally { await env.cleanup(); }
});

test("reload 应用外部资料；keep-local 保留草稿并禁止覆盖新活动资料", async () => {
  const reloadEnv = await setup();
  try {
    await act(async () => { nameInput(reloadEnv.renderer).props.onChange({ target: { value: "本地草稿" } }); });
    reloadEnv.setActive("profile-b");
    await reloadEnv.fire({ resumeProfileLibrary: { oldValue: {}, newValue: {} } });
    await act(async () => { await button(reloadEnv.renderer, "重新加载")?.props.onClick(); });
    assert.equal(nameInput(reloadEnv.renderer).props.value, "资料 B");
    assert.doesNotMatch(text(reloadEnv.renderer), /其他页面更新了当前简历/);
  } finally { await reloadEnv.cleanup(); }

  const keepEnv = await setup();
  try {
    await act(async () => { nameInput(keepEnv.renderer).props.onChange({ target: { value: "本地草稿" } }); });
    keepEnv.setActive("profile-b");
    await keepEnv.fire({ resumeProfileLibrary: { oldValue: {}, newValue: {} } });
    await act(async () => { button(keepEnv.renderer, "保留本地修改")?.props.onClick(); });
    assert.equal(nameInput(keepEnv.renderer).props.value, "本地草稿");
    assert.equal(button(keepEnv.renderer, "保存设置")?.props.disabled, true);
    await act(async () => { await button(keepEnv.renderer, "保存设置")?.props.onClick(); });
    assert.equal(keepEnv.saveCount(), 0);
    assert.match(text(keepEnv.renderer), /重新加载/);
  } finally { await keepEnv.cleanup(); }
});

test("外部资料 reload 失败时保留冲突提示并显示错误", async () => {
  const env = await setup();
  try {
    await act(async () => { nameInput(env.renderer).props.onChange({ target: { value: "本地草稿" } }); });
    env.setActive("profile-b");
    await env.fire({ resumeProfileLibrary: { oldValue: {}, newValue: {} } });
    env.failProfile(true);
    await act(async () => { await button(env.renderer, "重新加载")?.props.onClick(); });
    assert.equal(nameInput(env.renderer).props.value, "本地草稿");
    assert.match(text(env.renderer), /重新加载/);
    assert.match(text(env.renderer), /读取失败/);
  } finally { await env.cleanup(); }
});

test("奖项名称为空时阻止保存，只有名称时允许保存", async () => {
  const env = await setup();
  try {
    await act(async () => { button(env.renderer, "实习与项目")?.props.onClick(); });
    await act(async () => { button(env.renderer, "添加奖项 / 荣誉")?.props.onClick(); });
    assert.match(text(env.renderer), /请填写奖项名称/);
    await act(async () => { await button(env.renderer, "保存设置")?.props.onClick(); });
    assert.equal(env.saveCount(), 0);
    const input = env.renderer.root.findByProps({ placeholder: "请填写奖项名称" });
    await act(async () => { input.props.onChange({ target: { value: "优秀毕业生" } }); });
    await act(async () => { await button(env.renderer, "保存设置")?.props.onClick(); });
    assert.equal(env.saveCount(), 1);
  } finally { await env.cleanup(); }
});

test("设置页 AI 分类标注未启用", async () => {
  const env = await setup();
  try {
    assert.match(text(env.renderer), /AI 设置（未启用）/);
  } finally { await env.cleanup(); }
});

const legacyJson = JSON.stringify({
  schemaVersion: 1,
  facts: {
    "basic.name": { value: "合成姓名" },
    "basic.phone": { value: "13800000000" },
    "resume.skills": { value: "合成技能甲、合成技能乙" },
  },
  records: {
    "教育经历": {
      "0": {
        fields: {
          "education.school": { value: "合成大学" },
          "education.degree": { value: "本科" },
          "education.start_date": { value: "2018-09" },
          "education.end_date": { value: "2022-06" },
        },
        identityHints: {},
      },
    },
  },
});

test("旧版迁移区块只显示条数摘要，并把转换结果写入当前活动简历", async () => {
  const originalSend = MessageService.sendMessage;
  let savedProfile: UserProfile | null = null;
  let savedExpectedId = "";
  let imported = 0;
  MessageService.sendMessage = (async message => {
    if (message.type === "GET_ACTIVE_RESUME_CONTEXT") {
      return { success: true, data: { activeProfileId: "profile-a", profiles: [], profile: makeProfile("旧资料"), revision: "1" } };
    }
    if (message.type === "SAVE_USER_PROFILE") {
      const payload = message.payload as { profile: UserProfile; expectedProfileId: string };
      savedProfile = payload.profile;
      savedExpectedId = payload.expectedProfileId;
      return { success: true, data: { localSaved: true, sync: "disabled" } };
    }
    return { success: true };
  }) as typeof MessageService.sendMessage;
  let renderer!: TestRenderer.ReactTestRenderer;
  try {
    await act(async () => {
      renderer = TestRenderer.create(<LegacyImportSection onImported={() => { imported += 1; }} />);
    });
    assert.match(text(renderer), /从旧版校招助手导入（profile\.json）/);
    assert.match(text(renderer), /只显示条数摘要|本页只显示条数摘要/);

    const fileInput = renderer.root.findByType("input");
    const file = new File([legacyJson], "profile.json", { type: "application/json" });
    await act(async () => {
      fileInput.props.onChange({ target: { files: [file], value: "" } });
      await Promise.resolve();
      await Promise.resolve();
    });

    const summaryText = text(renderer);
    assert.match(summaryText, /已读取旧资料：\s*profile\.json/);
    assert.match(summaryText, /3\s*\/\s*3\s*项/);
    assert.match(summaryText, /教育经历/);
    // 摘要只显示条数：不得渲染任何个人答案值。
    assert.equal(summaryText.includes("合成姓名"), false);
    assert.equal(summaryText.includes("13800000000"), false);
    assert.equal(summaryText.includes("合成大学"), false);

    await act(async () => { button(renderer, "覆盖并导入")?.props.onClick(); });
    assert.match(text(renderer), /确认覆盖当前活动简历/);
    await act(async () => {
      await button(renderer, "确认覆盖并导入")?.props.onClick();
      await Promise.resolve();
      await Promise.resolve();
    });
    assert.equal(imported, 1);
    assert.equal(savedExpectedId, "profile-a");
    assert.equal(savedProfile?.personal.name, "合成姓名");
    assert.deepEqual(savedProfile?.skills, ["合成技能甲", "合成技能乙"]);
    assert.equal(savedProfile?.education[0].school, "合成大学");
    assert.match(text(renderer), /已导入，可在基本信息\/教育经历等页面核对/);
  } finally {
    await act(async () => { renderer?.unmount(); });
    MessageService.sendMessage = originalSend;
  }
});

test("项目经历与校园经历分开且详细成果字段可填写", async () => {
  const env = await setup();
  try {
    await act(async () => { button(env.renderer, "实习与项目")?.props.onClick(); });
    await act(async () => { button(env.renderer, "添加实习 / 工作经历")?.props.onClick(); });
    await act(async () => { button(env.renderer, "添加项目经历")?.props.onClick(); });
    const rendered = text(env.renderer);
    assert.match(rendered, /项目经历/);
    assert.match(rendered, /校园经历/);
    assert.match(rendered, /工作成果/);
    assert.match(rendered, /项目成果/);
    assert.match(rendered, /专业技能明细/);
    assert.match(rendered, /还没有自定义模块/);
    assert.doesNotMatch(rendered, /职业资格 \/ 证书|添加专业技能/);
  } finally { await env.cleanup(); }
});
