import type { DetectedField, FieldAliasOverrides } from '../shared/types';
import { FieldType } from '../shared/types';
import { FieldMatcher, matchField, type FieldMatchResult } from '../utils/fieldMatcher';
import { matchBlockedField } from '../shared/blockedFields.ts';
import { buildProfileAnswerCandidates, type ProfileAnswerCandidate } from '../shared/profileAnswerCandidates.ts';
import { collectFormControls } from './domControls.ts';

export interface UnmatchedField {
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  identifiers: ReturnType<typeof FieldMatcher.extractIdentifiers>;
  /** 未匹配原因（诊断报告用）。 */
  reason?: string;
}

export interface DetectOptions {
  /** 统一答案候选；传入后精确别名层优先于内置规则（方案 §6 第 3/4 层）。 */
  candidates?: ProfileAnswerCandidate[];
  aliasOverrides?: FieldAliasOverrides;
}

export class FormDetector {
  private observer: MutationObserver | null = null;
  private detectedFields: DetectedField[] = [];
  private unmatchedFields: UnmatchedField[] = [];
  private lastOptions: DetectOptions = {};

  // 检测页面中的所有表单字段
  detectFields(options: DetectOptions = {}): DetectedField[] {
    if (options.candidates) {
      this.lastOptions = options;
    } else if (Object.keys(options).length === 0 && this.lastOptions.candidates) {
      // 观察器触发的重检测沿用上一次的候选。
      options = this.lastOptions;
    }
    this.detectedFields = [];
    this.unmatchedFields = [];

    // 同时进入开放 Shadow DOM 与同源 iframe；过滤不应参与填写的按钮类 input。
    collectFormControls().forEach(control => {
      const inputType = control.tagName === 'INPUT'
        ? (control as HTMLInputElement).type.toLowerCase()
        : '';
      if (['hidden', 'submit', 'button', 'reset', 'image', 'radio', 'checkbox'].includes(inputType)) return;
      this.analyzeElement(control, options);
    });

    console.log(`Detected ${this.detectedFields.length} form fields, ${this.unmatchedFields.length} unmatched`);
    return this.detectedFields;
  }

  // 分析单个元素
  private analyzeElement(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    options: DetectOptions
  ): void {
    const isCombobox = element.getAttribute('role') === 'combobox';
    const isChoice = element.tagName === 'INPUT'
      && ((element as HTMLInputElement).type === 'checkbox' || (element as HTMLInputElement).type === 'radio');

    // 跳过不可见或禁用的元素
    if (
      (element.offsetParent === null && !isChoice) ||
      element.disabled ||
      ('readOnly' in element && element.readOnly && !isCombobox)
    ) {
      return;
    }

    // 提取元素标识符
    const identifiers = FieldMatcher.extractIdentifiers(element);
    const evidence = FieldMatcher.buildEvidence(identifiers, element);

    // 第 1 层：永久禁止字段——不进入匹配，也不进入 unmatched（AI/自定义都不可触碰）。
    const blocked = matchBlockedField(identifiers);
    if (blocked) {
      this.detectedFields.push({
        element,
        fieldType: FieldType.UNKNOWN,
        confidence: 0,
        blocked: true,
        matchReason: `禁止自动填写：${blocked.label}`,
      });
      return;
    }

    // 第 3-6 层统一匹配（候选精确别名 → 系统名称 → 上下文小 if → 安全复合标识符）。
    const match = matchField(evidence, {
      candidates: options.candidates,
      aliasOverrides: options.aliasOverrides,
    });

    if (match.status === 'ambiguous') {
      this.detectedFields.push({
        element,
        fieldType: FieldType.UNKNOWN,
        confidence: 0,
        ambiguous: true,
        matchReason: `${match.reason}（候选：${(match.candidates || []).join('、')}）`,
      });
      return;
    }

    if (match.status === 'matched' && this.pushMatchResult(element, match)) {
      return;
    }

    if (match.status === 'matched') {
      // 语义命中但当前资料没有可填的值：留空并记录原因（不走内置规则，防止误匹配）。
      this.unmatchedFields.push({ element, identifiers, reason: `${match.reason}；资料中无对应值` });
      return;
    }

    this.unmatchedFields.push({ element, identifiers, reason: match.reason });
  }

  /** 命中/冲突都算"已处理"；只有 unmatched 返回 false，继续走内置规则。 */
  private pushMatchResult(
    element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
    match: FieldMatchResult
  ): boolean {
    if (match.status === 'ambiguous') {
      this.detectedFields.push({
        element,
        fieldType: FieldType.UNKNOWN,
        confidence: 0,
        ambiguous: true,
        matchReason: `${match.reason}（候选：${(match.candidates || []).join('、')}）`,
      });
      return true;
    }
    if (match.status !== 'matched') return false;

    if (match.coreFieldType) {
      // 核心字段：沿用记录索引取值管线，保证重复教育/工作记录不错位。
      this.detectedFields.push({
        element,
        fieldType: match.coreFieldType,
        confidence: 0.95,
        value: element.value,
        matchReason: match.reason,
      });
      return true;
    }

    const candidates = this.lastOptions.candidates || [];
    const candidate = candidates.find(item => item.id === match.candidateId)
      // 上下文规则直接命中注册表 key（如国籍/民族）时，按 key 找到带值候选。
      || candidates.find(item => item.key === match.profileKey && item.value.trim());
    if (!candidate) return false;

    this.detectedFields.push({
      element,
      fieldType: candidate.id,
      confidence: 0.95,
      value: element.value,
      profileValue: candidate.value,
      matchReason: match.reason,
    });
    return true;
  }

  // 开始监听DOM变化
  startObserving(callback: (fields: DetectedField[]) => void): void {
    if (this.observer) {
      return;
    }

    this.observer = new MutationObserver((mutations) => {
      let shouldRedetect = false;

      for (const mutation of mutations) {
        // 检查是否添加了新的表单元素
        if (mutation.addedNodes.length > 0) {
          for (const node of Array.from(mutation.addedNodes)) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              const element = node as Element;
              if (
                element.tagName === 'INPUT' ||
                element.tagName === 'TEXTAREA' ||
                element.tagName === 'SELECT' ||
                element.querySelector('input, textarea, select')
              ) {
                shouldRedetect = true;
                break;
              }
            }
          }
        }

        if (shouldRedetect) break;
      }

      if (shouldRedetect) {
        const fields = this.detectFields();
        callback(fields);
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    console.log('Started observing DOM changes');
  }

  // 停止监听
  stopObserving(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
      console.log('Stopped observing DOM changes');
    }
  }

  // 获取已检测的字段
  getDetectedFields(): DetectedField[] {
    return this.detectedFields;
  }

  // 获取未匹配的字段（供后续 AI 功能使用）
  getUnmatchedFields(): UnmatchedField[] {
    return this.unmatchedFields;
  }

  // 根据字段类型查找元素
  findFieldsByType(fieldType: FieldType): DetectedField[] {
    return this.detectedFields.filter((field) => field.fieldType === fieldType);
  }

  // 查找文件上传控件
  findFileInputs(): HTMLInputElement[] {
    const fileInputs = collectFormControls()
      .filter((control): control is HTMLInputElement => (
        control.tagName === 'INPUT' && (control as HTMLInputElement).type === 'file'
      ));

    return fileInputs.filter((input) => {
      // 检查是否与简历相关
      const identifiers = FieldMatcher.extractIdentifiers(input);
      const searchText =
        `${identifiers.name} ${identifiers.id} ${identifiers.placeholder} ${identifiers.labelText}`.toLowerCase();

      return /简历|resume|cv|附件|attach/i.test(searchText);
    });
  }
}

function emptyIdentifiers(): ReturnType<typeof FieldMatcher.extractIdentifiers> {
  return {
    name: '',
    id: '',
    placeholder: '',
    labelText: '',
    type: '',
    autocomplete: '',
    moduleContext: '',
    rowContext: '',
  };
}
