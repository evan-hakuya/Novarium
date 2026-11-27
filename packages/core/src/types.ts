// 不依赖移植代码的公共类型，供服务端等只需校验的使用方单独导入。

/** 分章结果中的一个章节。偏移与长度都以整理后正文的 UTF-8 字节计算。 */
export interface ChapterDraft {
  /** 阅读顺序，从 0 开始连续编号。 */
  order: number;
  title: string;
  /** 章节序号；序章、番外这类没有编号的章节为 null。 */
  number: number | null;
  /** 所属卷的标题；没有卷的书为 null。 */
  volume: string | null;
  /** 作者公告（GLOSSARY「作者公告」）。只在整理预览中出现：服务端不保存它，书详情页按标题判断。 */
  notice?: boolean;
  /** 正文（不含标题行）在整理后正文中的起始字节。 */
  byteOffset: number;
  /** 正文的字节长度；空章节为 0。 */
  byteLength: number;
}
