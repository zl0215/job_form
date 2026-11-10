// File System Access API 的 TypeScript 补充声明。
//
// TypeScript 6 的 lib.dom 已经包含 FileSystemHandle / FileSystemFileHandle /
// FileSystemWritableFileStream / createWritable 等基础类型，但缺少：
//   - showOpenFilePicker / showSaveFilePicker（Window 上的选择器入口）
//   - FileSystemHandle.queryPermission / requestPermission（读写权限查询/申请）
//
// 这里只补充类型声明，不引入任何运行时实现或新依赖；运行时仍然由 Chromium
// 浏览器提供。非 Chromium 浏览器不支持这些 API，调用前必须做特性检测。
export {};

declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite';
  }

  interface FileSystemHandle {
    queryPermission(
      descriptor?: FileSystemHandlePermissionDescriptor,
    ): Promise<PermissionState>;
    requestPermission(
      descriptor?: FileSystemHandlePermissionDescriptor,
    ): Promise<PermissionState>;
  }

  type WellKnownDirectory =
    | 'desktop'
    | 'documents'
    | 'downloads'
    | 'music'
    | 'pictures'
    | 'videos';

  interface FilePickerAcceptType {
    description?: string;
    accept: Record<string, string | string[]>;
  }

  interface FilePickerOptions {
    types?: FilePickerAcceptType[];
    excludeAcceptAllOption?: boolean;
    id?: string;
    startIn?: WellKnownDirectory | FileSystemHandle;
  }

  interface OpenFilePickerOptions extends FilePickerOptions {
    multiple?: boolean;
  }

  interface SaveFilePickerOptions extends FilePickerOptions {
    suggestedName?: string;
  }

  interface Window {
    showOpenFilePicker?(
      options?: OpenFilePickerOptions,
    ): Promise<FileSystemFileHandle[]>;
    showSaveFilePicker?(
      options?: SaveFilePickerOptions,
    ): Promise<FileSystemFileHandle>;
  }
}
