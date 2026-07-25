import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import { ClassicIcon } from "./ClassicIcon";

type HelpBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string }
  | { type: "bullets" | "steps"; items: readonly string[] }
  | { type: "table"; label: string; columns: readonly string[]; rows: readonly (readonly string[])[] };

interface HelpTopic {
  id: string;
  title: string;
  blocks: readonly HelpBlock[];
}

const HELP_TOPICS = [
  {
    id: "start",
    title: "快速开始",
    blocks: [
      {
        type: "paragraph",
        text: "RunBeat 会在本机完成分析、试听和导出，音乐文件不会上传。推荐按下面的顺序制作一个项目。"
      },
      {
        type: "steps",
        items: [
          "在“项目属性”中设置目标步频、步频映射、自动选择范围和节拍轨。",
          "添加歌曲并等待 BPM、拍点和相位分析完成。",
          "按综合质量检查歌曲；优先试听“可接受”“不推荐”和“需校准”的项目。",
          "调整歌曲顺序与导出勾选；双击歌曲可试听处理后并带节拍轨的版本。",
          "按 Ctrl+E 打开导出向导，确认格式、节拍轨、响度和时间轴选项。"
        ]
      }
    ]
  },
  {
    id: "project-settings",
    title: "项目配置说明",
    blocks: [
      {
        type: "paragraph",
        text: "“项目 → 项目属性”中的设置会应用于整项工程。修改目标步频或映射方式后，歌曲的映射 BPM、变速、相位和综合质量会重新计算。"
      },
      {
        type: "table",
        label: "项目常规配置",
        columns: ["配置", "含义"],
        rows: [
          ["名称", "用于标题栏、本地项目列表、备份文件和导出文件名；未自定义时会按首曲名和歌曲数量自动生成。"],
          ["目标步频", "希望保持的每分钟步数，范围为 60～230 SPM，可覆盖快走到高步频跑步；它是所有处理后歌曲和节拍轨的统一速度。"],
          ["自动判断", "在一拍一步和一拍两步之间选择变速听感更合理的映射。"],
          ["一拍一步", "一个音乐拍点对应一步，适合拍点本身已接近目标 SPM 的歌曲。"],
          ["一拍两步", "一个音乐拍点对应左右两步，常用于约 70～100 BPM 的 half-time 歌曲。"],
          ["自动选择范围", "只决定新分析歌曲默认是否勾选导出；减速侧更严格、加速侧更宽松，手动勾选不会被自动覆盖。"]
        ]
      },
      {
        type: "table",
        label: "项目节拍轨配置",
        columns: ["配置", "含义"],
        rows: [
          ["声音", "选择内置脚步、鼓点、Click 或自定义单次声音；自定义文件不会嵌入项目备份。"],
          ["音量", "节拍轨相对音乐的增益，范围 -30～0 dB；0 dB 表示不衰减，并不保证不会掩盖音乐。"],
          ["重拍", "按每 4、8 或 16 步为脚步分组，将每组第 1 步加强；“无重拍”让所有步骤相同。"],
          ["左右脚声道交替", "让相邻脚步略偏向左右不同声道，帮助区分左右脚；扬声器下可能不如耳机明显。"],
          ["试听", "播放约 6 秒独立节拍轨，用于在混入歌曲前检查音色、音量、重拍和左右脚效果。"]
        ]
      }
    ]
  },
  {
    id: "metrics",
    title: "分析指标说明",
    blocks: [
      {
        type: "paragraph",
        text: "分析结果描述原曲节奏、目标步频与处理后固定步点网格之间的关系。"
      },
      {
        type: "table",
        label: "分析指标含义",
        columns: ["指标", "含义"],
        rows: [
          ["原始 BPM", "分析器从原曲估计的每分钟音乐拍数，尚未进行 half-time / double-time 映射。"],
          ["映射 BPM", "选择一拍一步或一拍两步后得到的有效节奏；拍点精修成功时还会进行不超过 2% 的微调。"],
          ["拍点", "分析器在原曲中检测到的音乐节拍时间点。它们用于判断节奏稳定性和相位，不是后来叠加的脚步声。"],
          ["目标 SPM", "期望的每分钟步数，也是处理后节拍轨和相位网格的主时钟。"],
          ["变速", "处理后相对原曲的速度变化；正数表示加速，负数表示减速。"],
          ["相位", "固定步点网格相对歌曲拍点从哪里开始，决定脚步提示是否落在音乐拍上。"],
          ["相位置信度", "综合拍点数量、覆盖与误差得到的锁定可信程度，越高越好。"],
          ["可靠拍点覆盖", "落在锁定网格容差内的检测拍点比例，越高表示整首歌越稳定。"],
          ["拍点中位误差", "检测拍点与锁定网格之间的典型时间偏差，毫秒数越低越好。"]
        ]
      }
    ]
  },
  {
    id: "phase",
    title: "相位锁定与拍点精修",
    blocks: [
      {
        type: "paragraph",
        text: "相位锁定解决“第一步从哪里开始”的问题：在映射 BPM 已确定的前提下，寻找能覆盖大多数检测拍点的固定网格偏移。自动锁定至少需要 4 个拍点，并要求主拍点簇覆盖至少 65%。"
      },
      {
        type: "paragraph",
        text: "拍点精修解决“固定网格会不会越走越偏”的问题：它从较长的拍点序列重新估计有效 BPM，只允许不超过 ±2% 的微调，并且只有相位拟合明显改善时才采用。精修完成后仍然要执行相位锁定。"
      },
      {
        type: "table",
        label: "相位状态含义",
        columns: ["状态", "含义与建议"],
        rows: [
          ["全局锁定", "直接使用全局映射 BPM 找到了稳定相位；通常只需试听确认。"],
          ["拍点精修", "先根据长段拍点微调映射 BPM，再锁定相位；建议在歌曲中后段试听是否仍贴拍。"],
          ["手动锁定", "使用手动填写的歌曲首拍作为相位；系统视为已确认，但仍应试听检查 BPM 是否正确。"],
          ["需校准 · 未锁定", "没有足够一致的拍点簇。先核对 BPM，再在“试听”页设置歌曲首拍。"]
        ]
      }
    ]
  },
  {
    id: "quality",
    title: "综合质量标准",
    blocks: [
      {
        type: "paragraph",
        text: "综合质量取“变速、全局 BPM 置信度、相位对齐”三个分项中最差的一项，因此一个项目即使 BPM 很准，也可能因为相位未锁定而显示“需校准”。"
      },
      {
        type: "table",
        label: "综合质量分项阈值",
        columns: ["分项", "优秀", "良好", "可接受", "不推荐 / 需校准"],
        rows: [
          ["变速", "-6% ～ +10%", "-15% ～ +20%", "-20% ～ +30%", "超出 -20% / +30%"],
          ["BPM 置信度", "≥ 80%", "60% ～ 79%", "40% ～ 59%", "< 40%"],
          ["相位对齐", "置信度 ≥82%、覆盖 ≥90%、误差 ≤15 ms", "≥72%、≥80%、≤25 ms", "≥62%、≥70%、≤35 ms", "任一指标低于可接受门槛或未锁定"]
        ]
      },
      {
        type: "heading",
        text: "如何处理各质量等级"
      },
      {
        type: "bullets",
        items: [
          "优秀：通常可以直接使用，仍建议快速试听带节拍轨版本。",
          "良好：一般可用；歌曲中后段试听一次可排除缓慢漂移。",
          "可接受：可能存在可闻变速或节拍误差，导出前应完整检查关键片段。",
          "不推荐：变速或 BPM 置信度超出建议范围，优先更换歌曲或手动确认 BPM。",
          "需校准：相位不可靠；核对 BPM 后手动设置首拍，再试听带节拍轨版本。"
        ]
      }
    ]
  },
  {
    id: "tracks",
    title: "歌曲编排与排序",
    blocks: [
      {
        type: "paragraph",
        text: "歌曲列表中的顺序就是连续导出的播放顺序。单击列标题进行排序时会同时改变播放顺序；“变速”列按带正负号的百分比从负到正或从正到负排列。"
      },
      {
        type: "bullets",
        items: [
          "Ctrl 或 Shift 配合单击可多选；Ctrl+A 选择全部歌曲。",
          "Space 切换所选歌曲是否加入导出；项目菜单可按当前非对称变速范围重新选择。",
          "直接拖拽一首歌曲可调整播放顺序；多选后从任一所选行开始拖拽，会把整组选中歌曲一起移动。",
          "Alt+上/下也可移动所选歌曲；Delete 从项目移除歌曲，但不会删除原始文件。",
          "右键歌曲可试听踩点、重新分析、移动或查看属性；右键列标题可隐藏和恢复数据列。"
        ]
      }
    ]
  },
  {
    id: "preview",
    title: "试听与手动校准",
    blocks: [
      {
        type: "paragraph",
        text: "右侧歌曲检查器跟随当前焦点歌曲。双击列表歌曲或按 Enter 会直接试听“处理后 + 节拍轨”，便于发现变速后的拍点偏移。"
      },
      {
        type: "bullets",
        items: [
          "原始音频：不变速、不加节拍，用作听感基准。",
          "处理后：保持音高并匹配目标 SPM，但不叠加脚步提示。",
          "处理后 + 节拍轨：同时检查变速听感和脚步是否贴拍。",
          "试听会从播放头连续播放到裁剪出点；拖动播放头后会从新位置继续。",
          "试听中修改首拍或提前/延后半拍，只会重排后续节拍，音乐不会中断。",
          "连续试听使用固定预览音量和过载保护；最终导出仍按项目中的响度标准化设置处理。",
          "如果整段都固定错位，调整首拍；如果越往后越偏，优先核对 BPM。",
          "裁剪入点后，相位会按新的歌曲起点换算，无需重复补偿同一段偏移。"
        ]
      }
    ]
  },
  {
    id: "beat-track",
    title: "节拍轨",
    blocks: [
      {
        type: "paragraph",
        text: "节拍轨按目标 SPM 生成脚步提示。它与分析器检测到的原曲拍点不同：拍点用于分析和对齐，节拍轨是最终试听或导出时叠加的声音。"
      },
      {
        type: "bullets",
        items: [
          "“每 N 步”会把每组的第 1 步设为重拍，例如每 4 步对应第 1、5、9…步；不会额外插入一步。",
          "当前重拍沿用同一音色并将振幅提高 35%（约 +2.6 dB），在较响的音乐中可能比较细微。",
          "左右脚声道交替会让奇偶脚步略偏向不同声道，耳机下更容易分辨。",
          "节拍轨音量是相对音乐的增益；试听时应以能辨认但不掩盖音乐为准。"
        ]
      }
    ]
  },
  {
    id: "saving",
    title: "项目保存与原文件",
    blocks: [
      {
        type: "paragraph",
        text: "加入第一首歌曲后，项目会按“歌曲名”或“歌曲名 等 X 首”自动命名并保存到当前浏览器；后续更改也会自动保存。Ctrl+S 可立即保存，Ctrl+Shift+S 可另存副本。"
      },
      {
        type: "bullets",
        items: [
          "项目保存分析结果、设置和编排，但不会复制或上传原始歌曲。",
          "刷新后项目仍在；浏览器出于安全限制会要求重新关联原始音频，之后才能试听、重分析或导出。",
          "清除站点数据会删除本地项目。重要项目应使用“备份项目文件”导出 .runbeat.json。"
        ]
      }
    ]
  },
  {
    id: "export",
    title: "导出音频与时间轴",
    blocks: [
      {
        type: "paragraph",
        text: "按 Ctrl+E 打开导出向导。连续模式生成一条按列表顺序衔接的混音；分别导出模式为每首所选歌曲生成独立文件。"
      },
      {
        type: "bullets",
        items: [
          "MP3 文件较小；WAV 为未压缩音频，体积更大。",
          "连续模式可以选择 JPG、PNG 或 WebP 封面，在本机生成 1920×1080 的 H.264 / AAC MP4；不选择图片时仍按普通音频导出。封面图片不会保存到项目或上传。",
          "“加入节拍轨”决定最终音频是否混入脚步提示，不影响歌曲的变速处理。",
          "响度标准化用于缩小歌曲之间的音量差异，真峰值保护用于减少削波风险。",
          "TXT / CSV 时间轴记录歌曲边界、BPM、变速和质量；字段文字跟随开始导出时的界面语言。"
        ]
      }
    ]
  },
  {
    id: "keyboard",
    title: "键盘操作",
    blocks: [
      {
        type: "table",
        label: "键盘快捷键",
        columns: ["按键", "功能"],
        rows: [
          ["Ctrl+N / Ctrl+O", "新建项目 / 打开本地项目"],
          ["Ctrl+S / Ctrl+Shift+S", "立即保存 / 另存副本"],
          ["Insert / Delete", "添加歌曲 / 移除所选歌曲"],
          ["Ctrl+A / Space", "全选歌曲 / 切换是否导出"],
          ["Alt+↑ / Alt+↓", "在播放顺序中移动所选歌曲"],
          ["Enter", "试听焦点歌曲的处理后 + 节拍轨版本"],
          ["Shift+F10", "打开焦点歌曲的右键菜单"],
          ["Ctrl+E", "打开导出向导"],
          ["F1 / Shift+F1", "查看当前控件说明 / 进入“这是什么？”模式"]
        ]
      }
    ]
  }
] as const satisfies readonly HelpTopic[];

const OPEN_SOURCE_TECHNOLOGIES = [
  { name: "Essentia.js", purpose: "音频 BPM 与拍点分析", license: "AGPL-3.0", href: "https://mtg.github.io/essentia.js/" },
  { name: "Rubber Band Library", purpose: "保持音高的变速处理", license: "GPL-2.0-or-later", href: "https://breakfastquay.com/rubberband/" },
  { name: "FFmpeg / ffmpeg.wasm", purpose: "音频解码与 MP3 编码", license: "MIT / GPL-2.0-or-later", href: "https://github.com/ffmpegwasm/ffmpeg.wasm" },
  { name: "98.css", purpose: "Windows 98 界面基础", license: "MIT", href: "https://jdan.github.io/98.css/" },
  { name: "WenQuanYi Bitmap Song", purpose: "中文点阵界面字体", license: "GPL-2.0 + font exception", href: "https://github.com/AmusementClub/WenQuanYi-Bitmap-Song-TTF" },
  { name: "React", purpose: "界面运行时", license: "MIT", href: "https://react.dev/" },
  { name: "Radix UI", purpose: "无障碍对话框基础", license: "MIT", href: "https://www.radix-ui.com/primitives" },
  { name: "Zustand", purpose: "应用状态管理", license: "MIT", href: "https://github.com/pmndrs/zustand" },
  { name: "Dexie.js", purpose: "本地项目存储", license: "Apache-2.0", href: "https://dexie.org/" },
  { name: "Zod", purpose: "项目文件校验", license: "MIT", href: "https://zod.dev/" },
  { name: "fflate", purpose: "流式 ZIP 打包", license: "MIT", href: "https://101arrowz.github.io/fflate/" }
] as const;

export function HelpTopicsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const [topicId, setTopicId] = useState<(typeof HELP_TOPICS)[number]["id"]>("start");
  const topic = HELP_TOPICS.find((item) => item.id === topicId) ?? HELP_TOPICS[0];
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-input-shield" />
        <Dialog.Content className="help-window window">
          <div className="title-bar">
            <Dialog.Title className="title-bar-text">RunBeat {t("帮助主题")}</Dialog.Title>
            <div className="title-bar-controls"><Dialog.Close asChild><button className="close" type="button" aria-label={t("关闭帮助")} /></Dialog.Close></div>
          </div>
          <div className="help-window-body">
            <div className="help-topic-list sunken-panel" role="tree" aria-label={t("帮助主题")}>
              {HELP_TOPICS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="treeitem"
                  aria-selected={topic.id === item.id}
                  className={topic.id === item.id ? "selected" : ""}
                  onClick={() => setTopicId(item.id)}
                >
                  <ClassicIcon name="help" size={14} />{t(item.title)}
                </button>
              ))}
            </div>
            <article className="help-topic-content sunken-panel">
              <h2>{t(topic.title)}</h2>
              {topic.blocks.map((block, blockIndex) => {
                if (block.type === "paragraph") return <p key={blockIndex}>{t(block.text)}</p>;
                if (block.type === "heading") return <h3 key={blockIndex}>{t(block.text)}</h3>;
                if (block.type === "bullets" || block.type === "steps") {
                  const List = block.type === "steps" ? "ol" : "ul";
                  return <List key={blockIndex}>{block.items.map((item) => <li key={item}>{t(item)}</li>)}</List>;
                }
                return <div className="help-table-wrap sunken-panel" key={blockIndex}>
                  <table aria-label={t(block.label)}>
                    <thead><tr>{block.columns.map((column) => <th key={column}>{t(column)}</th>)}</tr></thead>
                    <tbody>{block.rows.map((row) => <tr key={row[0]}>
                      {row.map((cell, cellIndex) => <td key={`${row[0]}-${cellIndex}`}>{t(cell)}</td>)}
                    </tr>)}</tbody>
                  </table>
                </div>;
              })}
              <p className="help-context-tip">{t("在对话框中把焦点移到某个控件后按 F1，可以查看更具体的说明。")}</p>
            </article>
          </div>
          <div className="dialog-command-row"><Dialog.Close asChild><button className="default" type="button">{t("关闭")}</button></Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function AboutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-input-shield" />
        <Dialog.Content className="about-dialog window">
          <div className="title-bar">
            <Dialog.Title className="title-bar-text">{t("关于 RunBeat")}</Dialog.Title>
            <div className="title-bar-controls"><Dialog.Close asChild><button className="close" type="button" aria-label={t("关闭")} /></Dialog.Close></div>
          </div>
          <div className="about-dialog-body">
            <div className="about-product-summary">
              <ClassicIcon name="app" size={32} />
              <div>
                <h2>RunBeat 0.1.0</h2>
                <p>{t("跑步音乐制作工具")}</p>
                <p>{t("隐私优先：所有音频分析与处理均在您的设备本地完成，文件不会上传。")}</p>
                <p title="SPDX: AGPL-3.0-or-later">GNU AGPL v3+</p>
              </div>
            </div>
            <fieldset className="about-open-source">
              <legend>{t("开源技术")}</legend>
              <p>{t("RunBeat 得益于以下开源项目，谨向所有作者与贡献者致谢。")}</p>
              <div className="about-technology-list sunken-panel">
                <table aria-label={t("开源技术")}>
                  <thead><tr><th>{t("技术")}</th><th>{t("用途")}</th><th>{t("许可证")}</th></tr></thead>
                  <tbody>{OPEN_SOURCE_TECHNOLOGIES.map((technology) => (
                    <tr key={technology.name}>
                      <td title={technology.name}><a href={technology.href} target="_blank" rel="noreferrer">{technology.name}</a></td>
                      <td title={t(technology.purpose)}>{t(technology.purpose)}</td>
                      <td title={technology.license}>{technology.license}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </fieldset>
          </div>
          <div className="dialog-command-row"><Dialog.Close asChild><button className="default" type="button">{t("确定")}</button></Dialog.Close></div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ContextHelpPopup({ text, x, y, onClose }: {
  text: string;
  x: number;
  y: number;
  onClose: () => void;
}) {
  return createPortal(
    <button
      type="button"
      className="context-help-popup"
      style={{ left: x, top: y }}
      onClick={onClose}
      onContextMenu={(event) => { event.preventDefault(); onClose(); }}
    >
      {text}
    </button>,
    document.querySelector<HTMLElement>("[role='dialog']") ?? document.body
  );
}
