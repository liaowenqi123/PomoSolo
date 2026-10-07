import { describe, it, expect } from "vitest";
import {
  parseDirPath,
  dirDepth,
  isInDir,
  isUncategorized,
  songDisplayName,
  isBuiltinSong,
  buildDirTree,
  renameDirPath,
} from "../musicLibrary";

describe("musicLibrary 目录路径工具", () => {
  it("parseDirPath 解析层级并忽略空段", () => {
    expect(parseDirPath("导入/周杰伦/范特西")).toEqual(["导入", "周杰伦", "范特西"]);
    expect(parseDirPath("")).toEqual([]);
    expect(parseDirPath("/")).toEqual([]);
    expect(parseDirPath("单层")).toEqual(["单层"]);
  });

  it("dirDepth 正确计算深度", () => {
    expect(dirDepth("")).toBe(0);
    expect(dirDepth("导入")).toBe(1);
    expect(dirDepth("导入/周杰伦")).toBe(2);
  });

  it("isInDir 目录包含自身与子目录，排除同级前缀", () => {
    expect(isInDir("导入/周杰伦/范特西", "导入/周杰伦")).toBe(true);
    expect(isInDir("导入/周杰伦", "导入/周杰伦")).toBe(true);
    expect(isInDir("导入/周杰伦x", "导入/周杰伦")).toBe(false);
    expect(isInDir("导入/其他", "导入/周杰伦")).toBe(false);
    expect(isInDir("", "导入")).toBe(false);
    expect(isInDir("导入", null)).toBe(true); // null = 全部
  });

  it("isUncategorized 只认空路径", () => {
    expect(isUncategorized("")).toBe(true);
    expect(isUncategorized("导入")).toBe(false);
  });

  it("songDisplayName 去扩展名，isBuiltinSong 识别 - 番茄钟", () => {
    expect(songDisplayName("a.mp3")).toBe("a");
    expect(songDisplayName("周杰伦 - 稻香.mp3")).toBe("周杰伦 - 稻香");
    expect(isBuiltinSong("Opening - 番茄钟.mp3")).toBe(true);
    expect(isBuiltinSong("普通歌.mp3")).toBe(false);
  });

  it("renameDirPath 同级替换最后一段", () => {
    expect(renameDirPath("导入/周杰伦", "依然范特西")).toBe("导入/依然范特西");
    expect(renameDirPath("导入", "导入2")).toBe("导入2");
  });
});

describe("musicLibrary buildDirTree（字段投影）", () => {
  it("由记录路径派生多级树，计数正确（直接数量 + 子树数量）", () => {
    const tree = buildDirTree([
      { path: "导入/周杰伦/范特西" },
      { path: "导入/周杰伦/叶惠美" },
      { path: "导入/其他" },
      { path: "喜欢" },
      { path: "" }, // 未分类不产生节点
    ]);
    expect(tree.map((n) => n.name)).toEqual(["导入", "喜欢"]);
    const dirImport = tree[0];
    expect(dirImport.count).toBe(0);
    expect(dirImport.subtreeCount).toBe(3);
    const children = dirImport.children.map((n) => n.name).sort();
    expect(children).toEqual(["其他", "周杰伦"]);
    const zhou = dirImport.children.find((n) => n.name === "周杰伦")!;
    expect(zhou.subtreeCount).toBe(2);
    expect(zhou.children.map((n) => n.name)).toEqual(["范特西", "叶惠美"]);
    expect(zhou.children[0].count).toBe(1);
    expect(zhou.children[0].subtreeCount).toBe(1);
    expect(tree[1].count).toBe(1);
  });

  it("空记录与全未分类不产生任何目录节点", () => {
    expect(buildDirTree([{ path: "" }, { path: "" }])).toEqual([]);
    expect(buildDirTree([])).toEqual([]);
  });

  it("重复路径只计一次", () => {
    const tree = buildDirTree([{ path: "A/B" }, { path: "A/B" }]);
    expect(tree[0].subtreeCount).toBe(1);
  });
});
