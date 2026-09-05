import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type AppLanguage = "zh-CN" | "en";

type TranslationValues = Record<string, string | number>;

interface I18nValue {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  t: (source: string, values?: TranslationValues) => string;
  translateMessage: (message?: string) => string;
}

const LANGUAGE_STORAGE_KEY = "runbeat.language.v1";

const HELP_ENGLISH: Record<string, string> = {
  "RunBeat 会在本机完成分析、试听和导出，音乐文件不会上传。推荐按下面的顺序制作一个项目。":
    "RunBeat performs analysis, preview, and export locally. Your music files are never uploaded. The following workflow is recommended.",
  "在“项目属性”中设置目标步频、步频映射、自动选择范围和节拍轨。":
    "Set the target cadence, cadence mapping, automatic selection range, and beat track in Project Properties.",
  "添加歌曲并等待 BPM、拍点和相位分析完成。":
    "Add tracks and wait for BPM, beat, and phase analysis to finish.",
  "按综合质量检查歌曲；优先试听“可接受”“不推荐”和“需校准”的项目。":
    "Review tracks by Overall Quality; preview Acceptable, Not recommended, and Needs calibration tracks first.",
  "调整歌曲顺序与导出勾选；双击歌曲可试听处理后并带节拍轨的版本。":
    "Adjust track order and export selection; double-click a track to preview the processed version with its beat track.",
  "按 Ctrl+E 打开导出向导，确认格式、节拍轨、响度和时间轴选项。":
    "Press Ctrl+E to open the Export Wizard and confirm format, beat-track, loudness, and timeline options.",

  "项目配置说明": "Project Settings",
  "“项目 → 项目属性”中的设置会应用于整项工程。修改目标步频或映射方式后，歌曲的映射 BPM、变速、相位和综合质量会重新计算。":
    "Settings under Project → Project Properties apply to the entire project. Changing the target cadence or mapping recalculates mapped BPM, tempo change, phase, and overall quality.",
  "项目常规配置": "General Project Settings",
  "配置": "Setting",
  "含义": "Meaning",
  "用于标题栏、本地项目列表、备份文件和导出文件名；未自定义时会按首曲名和歌曲数量自动生成。":
    "Used in the title bar, local project list, backup filename, and export filenames. If not customized, it is generated from the first track and track count.",
  "希望保持的每分钟步数，范围为 60～230 SPM，可覆盖快走到高步频跑步；它是所有处理后歌曲和节拍轨的统一速度。":
    "The desired steps per minute, from 60 to 230 SPM, covering brisk walking through high-cadence running. It is the shared cadence for all processed tracks and the beat track.",
  "在一拍一步和一拍两步之间选择变速听感更合理的映射。":
    "Chooses between one step per beat and two steps per beat based on the more reasonable-sounding tempo change.",
  "一个音乐拍点对应一步，适合拍点本身已接近目标 SPM 的歌曲。":
    "Maps one musical beat to one step. This suits tracks whose beat rate is already close to the target SPM.",
  "一个音乐拍点对应左右两步，常用于约 70～100 BPM 的 half-time 歌曲。":
    "Maps one musical beat to two alternating steps. This is often suitable for half-time tracks around 70–100 BPM.",
  "自动选择范围": "Automatic Selection Range",
  "只决定新分析歌曲默认是否勾选导出；减速侧更严格、加速侧更宽松，手动勾选不会被自动覆盖。":
    "Only controls whether newly analyzed tracks are selected for export by default. Slowdown is stricter than speed-up, and manual selections are never overwritten automatically.",
  "项目节拍轨配置": "Project Beat-track Settings",
  "声音": "Sound",
  "选择内置脚步、鼓点、Click 或自定义单次声音；自定义文件不会嵌入项目备份。":
    "Choose a built-in footstep, drum, click, or custom one-shot. Custom audio is not embedded in project backups.",
  "相对音量": "Relative Volume",
  "歌曲会先按导出目标响度标准化，再叠加节拍。范围为 -40～+10 dB；默认 -10 dB 保留原有 0 dB 的基础节拍强度，当前 0 dB 在此基础上再突出 10 dB，+10 dB 则突出 20 dB。高增益触发真峰值保护时，歌曲与节拍会一起降低电平。关闭响度标准化时则以歌曲实测响度为基准。":
    "The music is normalized to the export loudness target before the beat is added. The range is -40 to +10 dB. The -10 dB default retains the former 0 dB baseline beat strength; the current 0 dB is 10 dB more prominent and +10 dB is 20 dB more prominent than that baseline. If high gain triggers true-peak protection, music and beat are turned down together. When loudness normalization is off, the measured music loudness is used instead.",
  "重拍": "Accent",
  "按每 4、8 或 16 步为脚步分组，将每组第 1 步加强；“无重拍”让所有步骤相同。":
    "Groups footsteps in sets of 4, 8, or 16 and strengthens the first step of each group. No accent keeps every step the same.",
  "让相邻脚步略偏向左右不同声道，帮助区分左右脚；扬声器下可能不如耳机明显。":
    "Biases adjacent footsteps slightly toward opposite stereo channels to distinguish left and right feet. The effect may be less obvious on speakers than headphones.",
  "播放约 6 秒独立节拍轨，并以当前导出响度作为歌曲参考，用于在混入歌曲前检查音色、相对音量、重拍和左右脚效果。":
    "Plays about six seconds of the beat track by itself using the current export loudness as the music reference, so you can check its sound, relative volume, accent, and left/right effect before mixing it with music.",

  "分析指标说明": "Analysis Metrics",
  "分析结果描述原曲节奏、目标步频与处理后固定步点网格之间的关系。":
    "Analysis results describe the relationship between the original rhythm, target cadence, and processed fixed-step grid.",
  "分析指标含义": "Analysis Metric Meanings",
  "指标": "Metric",
  "分析器从原曲估计的每分钟音乐拍数，尚未进行 half-time / double-time 映射。":
    "Musical beats per minute estimated from the original track, before half-time or double-time mapping.",
  "选择一拍一步或一拍两步后得到的有效节奏；拍点精修成功时还会进行不超过 2% 的微调。":
    "The effective cadence after choosing one or two steps per beat. Successful beat refinement may adjust it by no more than 2%.",
  "分析器在原曲中检测到的音乐节拍时间点。它们用于判断节奏稳定性和相位，不是后来叠加的脚步声。":
    "Musical beat positions detected in the original track. They are used to assess rhythm stability and phase; they are not the footstep sounds added later.",
  "目标 SPM": "Target SPM",
  "期望的每分钟步数，也是处理后节拍轨和相位网格的主时钟。":
    "The desired steps per minute and the master clock for the processed beat track and phase grid.",
  "处理后相对原曲的速度变化；正数表示加速，负数表示减速。":
    "The processed speed change relative to the original. Positive values speed up the track; negative values slow it down.",
  "相位": "Phase",
  "固定步点网格相对歌曲拍点从哪里开始，决定脚步提示是否落在音乐拍上。":
    "Where the fixed-step grid begins relative to the track's beats. It determines whether footstep cues land on the music.",
  "相位置信度": "Phase Confidence",
  "综合拍点数量、覆盖与误差得到的锁定可信程度，越高越好。":
    "Confidence in the lock based on beat count, coverage, and error. Higher is better.",
  "可靠拍点覆盖": "Reliable Beat Coverage",
  "落在锁定网格容差内的检测拍点比例，越高表示整首歌越稳定。":
    "The share of detected beats that fall within the locked-grid tolerance. Higher coverage indicates a more stable track.",
  "拍点中位误差": "Median Beat Error",
  "检测拍点与锁定网格之间的典型时间偏差，毫秒数越低越好。":
    "The typical timing difference between detected beats and the locked grid. Lower milliseconds are better.",

  "相位锁定与拍点精修": "Phase Locking and Beat Refinement",
  "相位锁定解决“第一步从哪里开始”的问题：在映射 BPM 已确定的前提下，寻找能覆盖大多数检测拍点的固定网格偏移。自动锁定至少需要 4 个拍点，并要求主拍点簇覆盖至少 65%。":
    "Phase locking answers “where does the first step begin?” With mapped BPM fixed, it finds a grid offset that covers most detected beats. Automatic locking requires at least four beats and at least 65% coverage by the dominant beat cluster.",
  "拍点精修解决“固定网格会不会越走越偏”的问题：它从较长的拍点序列重新估计有效 BPM，只允许不超过 ±2% 的微调，并且只有相位拟合明显改善时才采用。精修完成后仍然要执行相位锁定。":
    "Beat refinement answers “will the fixed grid drift over time?” It re-estimates effective BPM from a longer beat sequence, permits at most a ±2% adjustment, and is used only when phase fit clearly improves. Phase is still locked after refinement.",
  "相位状态含义": "Phase Status Meanings",
  "含义与建议": "Meaning and Recommendation",
  "直接使用全局映射 BPM 找到了稳定相位；通常只需试听确认。":
    "A stable phase was found directly from the global mapped BPM. A brief preview is usually sufficient.",
  "先根据长段拍点微调映射 BPM，再锁定相位；建议在歌曲中后段试听是否仍贴拍。":
    "Mapped BPM was first adjusted from a long beat sequence, then phase was locked. Preview later in the track to confirm that it remains aligned.",
  "使用手动填写的歌曲首拍作为相位；系统视为已确认，但仍应试听检查 BPM 是否正确。":
    "Uses the manually entered first beat as phase. The system treats it as confirmed, but you should still preview the track to verify BPM.",
  "没有足够一致的拍点簇。先核对 BPM，再在“试听”页设置歌曲首拍。":
    "No sufficiently consistent beat cluster was found. Verify BPM first, then set the track's first beat on the Preview tab.",

  "综合质量标准": "Overall Quality Criteria",
  "综合质量取“变速、全局 BPM 置信度、相位对齐”三个分项中最差的一项，因此一个项目即使 BPM 很准，也可能因为相位未锁定而显示“需校准”。":
    "Overall Quality is the worst of Tempo Change, Global BPM Confidence, and Phase Alignment. A track with accurate BPM can therefore still be marked Needs calibration when phase is not locked.",
  "综合质量分项阈值": "Overall Quality Factor Thresholds",
  "分项": "Factor",
  "不推荐 / 需校准": "Not recommended / Needs calibration",
  "-6% ～ +10%": "-6% to +10%",
  "-15% ～ +20%": "-15% to +20%",
  "-20% ～ +30%": "-20% to +30%",
  "超出 -20% / +30%": "Outside -20% / +30%",
  "BPM 置信度": "BPM Confidence",
  "60% ～ 79%": "60% to 79%",
  "40% ～ 59%": "40% to 59%",
  "相位对齐": "Phase Alignment",
  "置信度 ≥82%、覆盖 ≥90%、误差 ≤15 ms": "Confidence ≥82%, coverage ≥90%, error ≤15 ms",
  "≥72%、≥80%、≤25 ms": "≥72%, ≥80%, ≤25 ms",
  "≥62%、≥70%、≤35 ms": "≥62%, ≥70%, ≤35 ms",
  "任一指标低于可接受门槛或未锁定": "Any metric below the acceptable threshold, or unlocked",
  "如何处理各质量等级": "How to Handle Each Quality Level",
  "优秀：通常可以直接使用，仍建议快速试听带节拍轨版本。":
    "Excellent: Usually ready to use; a quick preview with the beat track is still recommended.",
  "良好：一般可用；歌曲中后段试听一次可排除缓慢漂移。":
    "Good: Generally usable; preview later in the track once to rule out slow drift.",
  "可接受：可能存在可闻变速或节拍误差，导出前应完整检查关键片段。":
    "Acceptable: Tempo change or beat error may be audible. Check important sections before export.",
  "不推荐：变速或 BPM 置信度超出建议范围，优先更换歌曲或手动确认 BPM。":
    "Not recommended: Tempo change or BPM confidence is outside the recommended range. Prefer another track or verify BPM manually.",
  "需校准：相位不可靠；核对 BPM 后手动设置首拍，再试听带节拍轨版本。":
    "Needs calibration: Phase is unreliable. Verify BPM, set the first beat manually, then preview with the beat track.",

  "歌曲编排与排序": "Track Arrangement and Sorting",
  "歌曲列表中的顺序就是连续导出的播放顺序。单击列标题进行排序时会同时改变播放顺序；“变速”列按带正负号的百分比从负到正或从正到负排列。":
    "Track-list order is the playback order for continuous export. Sorting a column also changes playback order; Tempo Change sorts signed percentages from negative to positive or the reverse.",
  "Ctrl 或 Shift 配合单击可多选；Ctrl+A 选择全部歌曲。":
    "Use Ctrl- or Shift-click for multiple selection; Ctrl+A selects all tracks.",
  "Space 切换所选歌曲是否加入导出；项目菜单可按当前非对称变速范围重新选择。":
    "Space toggles whether selected tracks are exported. The Project menu can reset selection using the current asymmetric tempo range.",
  "直接拖拽一首歌曲可调整播放顺序；多选后从任一所选行开始拖拽，会把整组选中歌曲一起移动。":
    "Drag a track to change playback order. After selecting multiple tracks, dragging any selected row moves the entire selected group.",
  "Alt+上/下也可移动所选歌曲；Delete 从项目移除歌曲，但不会删除原始文件。":
    "Alt+Up/Down also moves selected tracks. Delete removes tracks from the project without deleting the original files.",
  "右键歌曲可试听踩点、重新分析、移动或查看属性；右键列标题可隐藏和恢复数据列。":
    "Right-click a track to preview beat alignment, reanalyze, move it, or view properties. Right-click a column header to hide or restore data columns.",
  "拖动列标题右边缘可调整列宽，拖动歌曲列表与检查器之间的分隔条可调整面板宽度；这些宽度会保存在当前浏览器。":
    "Drag a column header's right edge to resize it, or drag the divider between the track list and inspector to resize the pane. These widths are saved in this browser.",
  "Ctrl+Z 撤销项目编辑，Ctrl+Y 重做；重新分析也可以作为一个完整步骤撤销。":
    "Ctrl+Z undoes project edits and Ctrl+Y redoes them. Reanalysis can also be undone as one complete step.",

  "试听与手动校准": "Preview and Manual Calibration",
  "右侧歌曲检查器跟随当前焦点歌曲。双击列表歌曲或按 Enter 会直接试听“处理后 + 节拍轨”，便于发现变速后的拍点偏移。":
    "The Track Inspector follows the focused track. Double-click a list row or press Enter to preview Processed + Beat Track and reveal beat offset after tempo adjustment.",
  "原始音频：不变速、不加节拍，用作听感基准。":
    "Original Audio: No tempo adjustment or beat track; use it as the listening reference.",
  "处理后：保持音高并匹配目标 SPM，但不叠加脚步提示。":
    "Processed: Preserves pitch and matches target SPM without footstep cues.",
  "处理后 + 节拍轨：同时检查变速听感和脚步是否贴拍。":
    "Processed + Beat Track: Check both tempo-adjusted sound and footstep alignment.",
  "试听会从播放头连续播放到裁剪出点；拖动播放头后会从新位置继续。":
    "Preview plays continuously from the playhead to the trim out point. Drag the playhead to continue from a new position.",
  "试听中修改首拍或提前/延后半拍，只会重排后续节拍，音乐不会中断。":
    "Changing the first beat or half-beat offset during preview reschedules future beats without interrupting the music.",
  "连续试听使用固定预览音量和过载保护；最终导出仍按项目中的响度标准化设置处理。":
    "Continuous preview uses a fixed monitoring level and overload protection. Final export still follows the project's loudness-normalization setting.",
  "如果整段都固定错位，调整首拍；如果越往后越偏，优先核对 BPM。":
    "If the whole segment has a fixed offset, adjust the first beat. If drift grows over time, verify BPM first.",
  "裁剪入点后，相位会按新的歌曲起点换算，无需重复补偿同一段偏移。":
    "After trimming the in point, phase is converted for the new track start, so the same offset does not need to be compensated twice.",

  "节拍轨按目标 SPM 生成脚步提示。它与分析器检测到的原曲拍点不同：拍点用于分析和对齐，节拍轨是最终试听或导出时叠加的声音。":
    "The beat track generates footstep cues at target SPM. It differs from beats detected in the original: detected beats are used for analysis and alignment, while the beat track is audio added during preview or export.",
  "“每 N 步”会把每组的第 1 步设为重拍，例如每 4 步对应第 1、5、9…步；不会额外插入一步。":
    "Every N steps accents the first step of each group. Every 4 steps accents steps 1, 5, 9, and so on; it does not insert an extra step.",
  "当前重拍沿用同一音色并将振幅提高 35%（约 +2.6 dB），在较响的音乐中可能比较细微。":
    "The current accent uses the same sound at 35% higher amplitude (about +2.6 dB), so it may be subtle against loud music.",
  "左右脚声道交替会让奇偶脚步略偏向不同声道，耳机下更容易分辨。":
    "Left/right alternation biases odd and even footsteps slightly toward opposite channels and is easier to hear on headphones.",
  "节拍轨以标准化后的歌曲响度为参考。默认 -10 dB 保留原有 0 dB 的基础节拍强度，当前 0 dB 在此基础上再突出 10 dB，+10 dB 则突出 20 dB。高增益可能触发整体真峰值保护，但节拍相对歌曲的差值不变；试听时应以能辨认但不掩盖音乐为准。":
    "The beat track is referenced to normalized music loudness. The -10 dB default retains the former 0 dB baseline beat strength; the current 0 dB is 10 dB more prominent and +10 dB is 20 dB more prominent than that baseline. High gain may trigger whole-mix true-peak protection, but the beat-to-music difference is preserved. Keep it recognizable without masking the music.",

  "项目保存与原文件": "Project Saving and Original Files",
  "加入第一首歌曲后，项目会按“歌曲名”或“歌曲名 等 X 首”自动命名并保存到当前浏览器；后续更改也会自动保存。Ctrl+S 可立即保存，Ctrl+Shift+S 可另存副本。":
    "After the first track is added, the project is automatically named from the first track and track count and saved in the current browser. Later changes are autosaved. Ctrl+S saves immediately; Ctrl+Shift+S saves a copy.",
  "项目保存分析结果、设置和编排，但不会复制或上传原始歌曲。":
    "A project stores analysis results, settings, and arrangement, but does not copy or upload the original tracks.",
  "刷新后项目仍在；浏览器出于安全限制会要求重新关联原始音频，之后才能试听、重分析或导出。":
    "The project remains after refresh. Browser security requires the original audio to be relinked before preview, reanalysis, or export.",
  "“文件”菜单会列出最近使用的五个本地项目，可通过数字项快速打开。":
    "The File menu lists the five most recently used local projects as numbered shortcuts.",
  "清除站点数据会删除本地项目。重要项目应使用“备份项目文件”导出 .runbeat.json。":
    "Clearing site data deletes local projects. Use Back Up Project File to export a .runbeat.json copy of important projects.",

  "导出音频与时间轴": "Audio Export and Timelines",
  "按 Ctrl+E 打开导出向导。连续模式生成一条按列表顺序衔接的混音；分别导出模式为每首所选歌曲生成独立文件。":
    "Press Ctrl+E to open the Export Wizard. Continuous mode creates one mix in list order; separate mode creates one file for each selected track.",
  "项目可保存任意数量的歌曲；为控制浏览器资源占用，一次最多导出 50 首。":
    "A project can store any number of tracks. To control browser resource usage, each export is limited to 50 tracks.",
  "MP3 文件较小；WAV 为未压缩音频，体积更大。":
    "MP3 files are smaller; WAV is uncompressed and larger.",
  "连续模式可以选择 JPG、PNG 或 WebP 封面，在本机生成 1920×1080 的 H.264 / AAC MP4；不选择图片时仍按普通音频导出。封面图片不会保存到项目或上传。":
    "Continuous mode can use a JPG, PNG, or WebP cover to create a 1920×1080 H.264/AAC MP4 locally. Without an image, it exports regular audio. The cover is not saved in the project or uploaded.",
  "“加入节拍轨”决定最终音频是否混入脚步提示，不影响歌曲的变速处理。":
    "Include Beat Track controls whether footstep cues are mixed into the final audio; it does not affect tempo processing.",
  "响度标准化用于缩小歌曲之间的音量差异，真峰值保护用于减少削波风险。":
    "Loudness normalization reduces volume differences between tracks; true-peak protection reduces clipping risk.",
  "TXT / CSV 时间轴记录歌曲边界、BPM、变速和质量；字段文字跟随开始导出时的界面语言。":
    "TXT and CSV timelines record track boundaries, BPM, tempo change, and quality. Field text follows the interface language selected when export begins.",

  "键盘操作": "Keyboard Controls",
  "键盘快捷键": "Keyboard Shortcuts",
  "按键": "Key",
  "功能": "Action",
  "新建项目 / 打开本地项目": "New project / Open local project",
  "立即保存 / 另存副本": "Save now / Save a copy",
  "撤销 / 重做项目编辑": "Undo / Redo project edits",
  "添加歌曲 / 移除所选歌曲": "Add tracks / Remove selected tracks",
  "全选歌曲 / 切换是否导出": "Select all tracks / Toggle export",
  "在播放顺序中移动所选歌曲": "Move selected tracks in playback order",
  "试听焦点歌曲的处理后 + 节拍轨版本": "Preview Processed + Beat Track for the focused track",
  "打开焦点歌曲的右键菜单": "Open the focused track's context menu",
  "打开导出向导": "Open the Export Wizard",
  "查看当前控件说明 / 进入“这是什么？”模式": "Show help for the current control / Enter What's This? mode"
};

const ENGLISH: Record<string, string> = {
  ...HELP_ENGLISH,
  "工具": "Tools",
  "鼓点库": "Beat Library",
  "选项": "Options",
  "界面语言": "Interface language",
  "这些选项适用于此浏览器中的所有项目。": "These options apply to all projects in this browser.",
  "管理可跨项目使用的鼓点，上传、试听、下载和清理素材。": "Upload, preview, download and clean up beats shared across projects.",
  "设置界面语言等应用选项。": "Set the interface language and application options.",
  "鼓点保存在当前浏览器，可供所有本地项目使用。支持不超过 3 秒、10 MB 的单次鼓点音频。": "Beats are stored in this browser and shared by all local projects. Upload one-shot audio up to 3 seconds and 10 MB.",
  "上传...": "Upload...",
  "上传鼓点": "Upload beats",
  "下载": "Download",
  "删除鼓点": "Delete Beat",
  "重命名...": "Rename...",
  "重命名鼓点": "Rename Beat",
  "鼓点名称:": "Beat name:",
  "原文件：{name}": "Original file: {name}",
  "已重命名为“{name}”。": "Renamed to “{name}”.",
  "请输入鼓点名称。": "Enter a beat name.",
  "鼓点名称不能超过 80 个字符。": "Beat names must not exceed 80 characters.",
  "鼓点库中已有这个名称，请换一个名称。": "This name is already used in the library. Choose another name.",
  "正在加载...": "Loading...",
  "正在处理...": "Working...",
  "清理未使用...": "Clean Up Unused...",
  "查找鼓点:": "Find beats:",
  "鼓点列表": "Beat list",
  "占用空间": "Storage",
  "使用情况": "Usage",
  "{count} 个项目": "{count} projects",
  "编辑中": "In editing",
  "未使用": "Unused",
  "没有匹配的鼓点。": "No matching beats.",
  "鼓点库为空，点击“上传”添加第一个鼓点。": "The library is empty. Click Upload to add your first beat.",
  "用于项目：{names}": "Used by: {names}",
  "当前编辑或撤销记录仍在使用这个鼓点。": "An open project, draft or undo history is still using this beat.",
  "未使用的鼓点可删除，也可保留供以后使用。": "Unused beats can be deleted or kept for future projects.",
  "此旧鼓点没有保留原文件，下载时会导出为 WAV。": "The original file for this older beat was not retained. It will download as WAV.",
  "{count} 个鼓点，共 {size}": "{count} beats, {size} total",
  "清理未使用鼓点": "Clean Up Unused Beats",
  "要删除这 {count} 个未使用鼓点吗？包括尚未用于项目的新上传鼓点。正在使用的资源会保留。": "Delete these {count} unused beats? This includes new uploads not yet used in projects. Beats still in use will be kept.",
  "要从鼓点库中永久删除“{name}”吗？": "Permanently delete “{name}” from the beat library?",
  "已清理 {deleted} 个鼓点，保留 {skipped} 个使用中的鼓点。": "Deleted {deleted} beats; kept {skipped} beats still in use.",
  "已加入鼓点库；相同文件会自动复用。": "Added to the library. Identical files are reused automatically.",
  "内置鼓点": "Built-in beats",
  "不可用": "Unavailable",
  "打开鼓点库": "Open Beat Library",
  "可在鼓点库上传自己的鼓点。": "Upload your own beats in the beat library.",
  "鼓点已被删除，请重新选择。": "This beat has been deleted. Please choose another.",
  "请从鼓点库选择一个可用的鼓点。": "Choose an available beat from the beat library.",
  "自定义鼓点文件不能超过 10 MB": "Custom beat files must not exceed 10 MB.",
  "没有从文件中解码出可用的鼓点音频": "No usable beat audio could be decoded from this file.",
  "请上传不超过 3 秒的单次鼓点音频": "Upload one-shot beat audio no longer than 3 seconds.",
  "鼓点音频音量过低或接近静音": "The beat audio is too quiet or nearly silent.",
  "这个鼓点仍被项目、当前编辑或撤销记录使用。请更换并保存引用它的项目，再关闭对应编辑页。": "This beat is still used by a project, open editor, or undo history. Change the referencing projects, save them, then close their editors.",
  "当前浏览器不支持安全删除鼓点，请使用新版浏览器。": "This browser cannot safely delete shared beats. Please use an up-to-date browser.",
  "在“工具 → 鼓点库”上传、试听、下载和清理自定义鼓点；在项目属性中选择使用。鼓点可跨项目复用，但音频不会嵌入项目备份。": "Upload, preview, download and clean up custom beats under Tools → Beat Library, then select one in Project Properties. Beats are shared across projects, but audio is not embedded in project backups.",
  "文件": "File",
  "编辑": "Edit",
  "查看": "View",
  "项目": "Project",
  "帮助": "Help",
  "新建项目": "New Project",
  "打开项目": "Open Project",
  "保存项目": "Save Project",
  "项目另存为": "Save Project As",
  "添加歌曲": "Add Tracks",
  "导入项目文件": "Import Project File",
  "备份项目文件": "Back Up Project File",
  "导出音频": "Export Audio",
  "关闭项目": "Close Project",
  "撤销": "Undo",
  "重做": "Redo",
  "全选歌曲": "Select All Tracks",
  "加入导出": "Include in Export",
  "排除导出": "Exclude from Export",
  "上移": "Move Up",
  "下移": "Move Down",
  "删除": "Delete",
  "歌曲属性": "Track Properties",
  "工具栏": "Toolbar",
  "状态栏": "Status Bar",
  "歌曲检查器": "Track Inspector",
  "项目属性": "Project Properties",
  "删除项目": "Delete Project",
  "按当前范围重新选择": "Reset Selection to Current Range",
  "重新分析所选歌曲": "Reanalyze Selected Tracks",
  "重新关联文件": "Relink Files",
  "帮助主题": "Help Topics",
  "这是什么？": "What's This?",
  "语言": "Language",
  "中文": "Chinese",
  "英文": "English",
  "关于 RunBeat": "About RunBeat",
  "创建一个新的未命名项目。": "Create a new untitled project.",
  "打开保存在当前设备上的项目。": "Open a project saved on this device.",
  "打开最近使用的项目“{name}”。": "Open the recent project “{name}”.",
  "保存当前项目。": "Save the current project.",
  "用新名称保存项目副本。": "Save a copy of the project under a new name.",
  "向当前项目添加音频文件。": "Add audio files to the current project.",
  "从 .runbeat.json 文件导入项目。": "Import a project from a .runbeat.json file.",
  "下载当前项目的 JSON 备份。": "Download a JSON backup of the current project.",
  "打开导出音频向导。": "Open the Export Audio Wizard.",
  "关闭当前项目并返回本地项目列表。": "Close the current project and return to the local project list.",
  "撤销上一步项目编辑。": "Undo the last project edit.",
  "重做刚刚撤销的项目编辑。": "Redo the last undone project edit.",
  "选择列表中的全部歌曲。": "Select every track in the list.",
  "把所选歌曲加入导出。": "Include the selected tracks in the export.",
  "从导出中排除所选歌曲。": "Exclude the selected tracks from the export.",
  "在播放顺序中上移所选歌曲。": "Move the selected tracks up in playback order.",
  "在播放顺序中下移所选歌曲。": "Move the selected tracks down in playback order.",
  "从项目中删除所选歌曲。": "Remove the selected tracks from the project.",
  "显示焦点歌曲的检查器。": "Show the inspector for the focused track.",
  "显示或隐藏工具栏。": "Show or hide the toolbar.",
  "显示或隐藏状态栏。": "Show or hide the status bar.",
  "显示或隐藏歌曲检查器。": "Show or hide the Track Inspector.",
  "设置项目名称、目标步频和全局节拍轨。": "Set the project name, target cadence, and global beat track.",
  "永久删除本地项目列表中所选的项目。": "Permanently delete the selected local project.",
  "永久删除当前项目并返回本地项目列表。": "Permanently delete the current project and return to the local project list.",
  "根据项目的变速范围重新设置默认导出歌曲。": "Reset the default export selection using the project's tempo range.",
  "重新分析当前所选歌曲的 BPM 与拍点。": "Reanalyze BPM and beats for the selected tracks.",
  "重新选择保存项目引用的原始音频文件。": "Choose the original audio files referenced by this project again.",
  "打开 RunBeat 帮助主题。": "Open RunBeat Help Topics.",
  "单击一个控件查看它的说明。": "Click a control to see its description.",
  "选择界面语言。": "Choose the interface language.",
  "将界面语言切换为中文。": "Switch the interface language to Chinese.",
  "将界面语言切换为英文。": "Switch the interface language to English.",
  "显示程序版本和许可证信息。": "Display program version and license information.",
  "本地项目": "Local Projects",
  "关于": "About",
  "未命名项目": "Untitled Project",
  "正在保存...": "Saving...",
  "未保存": "Not saved",
  "尚未保存": "Not saved yet",
  "就绪": "Ready",
  "正在分析歌曲：{done}/{total}": "Analyzing tracks: {done}/{total}",
  "正在分析歌曲：{done}/{total} · {percent}%": "Analyzing tracks: {done}/{total} · {percent}%",
  "分析进度": "Analysis progress",
  "已保存 {time}": "Saved {time}",
  "{count} 首歌曲 · {spm} SPM": "{count} tracks · {spm} SPM",
  "RunBeat 主窗口": "RunBeat Main Window",
  "应用程序菜单": "Application menu",
  "常用命令": "Common commands",

  "快速开始": "Getting Started",
  "歌曲编排": "Track Arrangement",
  "试听与校准": "Preview and Calibration",
  "使用“文件”菜单添加歌曲。RunBeat 会在本机自动分析 BPM 与拍点；完成后可在歌曲列表中选择、排序和试听。":
    "Use the File menu to add tracks. RunBeat analyzes BPM and beats locally; when finished, you can select, sort, and preview tracks in the list.",
  "在“项目”菜单中打开“项目属性”。常规页设置目标步频和自动匹配规则，节拍轨页设置全局脚步提示。":
    "Open Project Properties from the Project menu. Use General for target cadence and matching rules, and Beat Track for the global footstep cue.",
  "详细列表中的顺序就是连续导出的播放顺序。使用 Ctrl/Shift 多选，Space 切换是否导出，Alt+上/下移动歌曲。":
    "The detail-list order is the playback order for continuous export. Use Ctrl/Shift to select, Space to toggle export, and Alt+Up/Down to move tracks.",
  "右侧歌曲检查器跟随焦点歌曲。“试听”页可比较原始、处理后和含节拍版本，并提供手动 BPM、首拍和裁剪。":
    "The Track Inspector follows the focused track. Preview compares original, processed, and beat-track versions and provides manual BPM, first-beat, and trim controls.",
  "按 Ctrl+E 打开导出向导。依次选择内容、音频格式并确认摘要；导出期间可以取消，音乐不会上传。":
    "Press Ctrl+E to open the Export Wizard. Choose the content and audio format, then review the summary. You can cancel during export, and your music is never uploaded.",
  "加入第一首歌曲后，项目会按“歌曲名”或“歌曲名 等 X 首”自动命名并保存到本机；后续更改也会自动保存。Ctrl+S 可立即保存，Ctrl+Shift+S 可另存副本。":
    "After the first track is added, the project is automatically named from its first track and track count and saved locally. Later changes are also saved automatically. Press Ctrl+S to save immediately or Ctrl+Shift+S to save a copy.",
  "在对话框中把焦点移到某个控件后按 F1，可以查看更具体的说明。":
    "In a dialog, move focus to a control and press F1 for a more specific description.",
  "关闭帮助": "Close Help",
  "关闭": "Close",
  "跑步音乐制作工具": "Running Music Builder",
  "隐私优先：所有音频分析与处理均在您的设备本地完成，文件不会上传。":
    "Privacy first: all audio analysis and processing is performed locally on your device. Your files are never uploaded.",
  "GitHub 源代码仓库": "GitHub Source Repository",
  "开源技术": "Open-source Technologies",
  "RunBeat 得益于以下开源项目，谨向所有作者与贡献者致谢。":
    "RunBeat is made possible by the following open-source projects. With thanks to every author and contributor.",
  "技术": "Technology",
  "用途": "Purpose",
  "许可证": "License",
  "音频 BPM 与拍点分析": "Audio BPM and beat analysis",
  "保持音高的变速处理": "Pitch-preserving time stretching",
  "音频解码与 MP3 编码": "Audio decoding and MP3 encoding",
  "Windows 98 界面基础": "Windows 98 interface foundation",
  "中文点阵界面字体": "Chinese bitmap interface font",
  "界面运行时": "Interface runtime",
  "无障碍对话框基础": "Accessible dialog primitives",
  "应用状态管理": "Application state management",
  "本地项目存储": "Local project storage",
  "项目文件校验": "Project file validation",
  "流式 ZIP 打包": "Streaming ZIP packaging",
  "确定": "OK",

  "查找范围:": "Look in:",
  "名称": "Name",
  "歌曲": "Tracks",
  "目标步频": "Target Cadence",
  "修改日期": "Date Modified",
  "没有已保存的项目。": "No saved projects.",
  "新建...": "New...",
  "打开": "Open",
  "删除(Y)": "Delete(Y)",
  "要永久删除“{name}”吗？": "Permanently delete “{name}”?",
  "要永久删除“{name}”吗？此操作无法撤销。": "Permanently delete “{name}”? This action cannot be undone.",
  "项目名称:": "Project name:",
  "保存": "Save",
  "取消": "Cancel",
  "正在读取项目...": "Reading projects...",
  "当前打开的项目请使用“项目”菜单删除。": "Use the Project menu to delete the currently open project.",

  "等待分析": "Waiting",
  "正在解码": "Decoding",
  "分析 BPM": "Analyzing BPM",
  "分析拍点": "Analyzing beats",
  "分析完成": "Analysis complete",
  "分析失败": "Analysis failed",
  "需要原文件": "Original file needed",
  "导出": "Export",
  "状态": "Status",
  "原始 BPM": "Original BPM",
  "节奏 BPM": "Rhythm BPM",
  "映射 BPM": "Mapped BPM",
  "映射方式": "Mapping",
  "检测倍频 ×{value}": "Detector octave ×{value}",
  "拍点": "Beats",
  "相位准确率": "Phase Accuracy",
  "变速": "Tempo Change",
  "输出时长": "Output Duration",
  "综合质量": "Overall Quality",
  "歌曲详细列表": "Track detail list",
  "调整歌曲检查器宽度": "Resize Track Inspector",
  "列设置": "Column Settings",
  "隐藏“{column}”": "Hide “{column}”",
  "调整“{column}”列宽": "Resize the “{column}” column",
  "重置“{column}”列宽": "Reset “{column}” Column Width",
  "显示所有列": "Show All Columns",
  "右键单击可选择显示的列。": "Right-click to choose which columns are shown.",
  "{count} 个": "{count}",
  "手动": "Manual",
  "共检测到 {count} 个拍点": "{count} beats detected",
  "相位置信度 {value}%": "Phase confidence {value}%",
  "拍点中位误差 {value} ms": "Median beat error {value} ms",
  "可靠拍点覆盖 {value}%": "Reliable beat coverage {value}%",
  "综合评级取最差项：变速 {tempo}；BPM 置信度 {bpm}；相位 {phase}":
    "Overall rating uses the weakest factor: tempo {tempo}; BPM confidence {bpm}; phase {phase}",
  "优秀": "Excellent",
  "良好": "Good",
  "可接受": "Acceptable",
  "不推荐": "Not recommended",
  "需校准": "Needs calibration",
  "要添加歌曲，请选择“文件”菜单中的“添加歌曲”，或将音频文件拖到此处。":
    "To add tracks, choose Add Tracks from the File menu, or drag audio files here.",
  "试听踩点": "Preview with Beat",
  "重新分析": "Reanalyze",

  "未选择歌曲": "No track selected",
  "分析": "Analysis",
  "试听": "Preview",
  "歌曲属性页": "Track property pages",
  "在歌曲列表中选择一首歌曲。": "Select a track in the track list.",
  "分析结果": "Analysis Results",
  "分析结论": "Analysis Summary",
  "节奏与输出": "Tempo and Output",
  "质量评估": "Quality Assessment",
  "拍点信息": "Beat Details",
  "主估计": "Primary BPM",
  "节奏估计": "Rhythm BPM",
  "最终采用": "Applied BPM",
  "时长": "Duration",
  "检测拍点": "Detected Beats",
  "自动首拍": "Auto First Beat",
  "锁定方式": "Lock Method",
  "秒": "sec",
  "测量结果": "Measurement",
  "评价": "Rating",
  "差值 {value} BPM": "Difference {value} BPM",
  "手动确认": "Manually confirmed",
  "估计器差值": "Estimator Difference",
  "BPM 精修": "BPM Refinement",
  "未采用": "Not used",
  "综合质量计算": "Overall Quality Calculation",
  "综合质量取“变速、BPM 置信度、相位对齐”三个分项中最差的一项。":
    "Overall quality is the weakest of Tempo Change, BPM Confidence, and Phase Alignment.",
  "决定项": "Deciding factor",
  "优秀范围：-6% ～ +10%": "Excellent range: -6% to +10%",
  "良好范围：-15% ～ +20%": "Good range: -15% to +20%",
  "可接受范围：-20% ～ +30%": "Acceptable range: -20% to +30%",
  "超出 -20% ～ +30%": "Outside -20% to +30%",
  "需要校准": "Needs calibration",
  "优秀范围：≥80%": "Excellent range: ≥80%",
  "良好范围：60% ～ 79%": "Good range: 60% to 79%",
  "可接受范围：40% ～ 59%": "Acceptable range: 40% to 59%",
  "低于 40%": "Below 40%",
  "手动首拍视为已确认": "A manual first beat is treated as confirmed",
  "优秀：置信度 ≥82%、覆盖 ≥90%、误差 ≤15 ms": "Excellent: confidence ≥82%, coverage ≥90%, error ≤15 ms",
  "良好：置信度 ≥72%、覆盖 ≥80%、误差 ≤25 ms": "Good: confidence ≥72%, coverage ≥80%, error ≤25 ms",
  "可接受：置信度 ≥62%、覆盖 ≥70%、误差 ≤35 ms": "Acceptable: confidence ≥62%, coverage ≥70%, error ≤35 ms",
  "相位质量不推荐": "Phase quality is not recommended",
  "未锁定或低于可接受门槛": "Unlocked or below the acceptable threshold",
  "置信度 {value}%": "Confidence {value}%",
  "覆盖 {value}%": "Coverage {value}%",
  "误差 {value} ms": "Error {value} ms",
  "建议:": "Recommendation:",
  "调整目标步频或映射方式，并试听确认": "Adjust the target cadence or mapping, then preview to confirm",
  "手动确认 BPM": "Confirm BPM manually",
  "试听确认": "Preview to confirm",
  "试听并手动设置歌曲首拍": "Preview and set the track’s first beat manually",
  "时长:": "Duration:",
  "拍点:": "Beats:",
  "相位:": "Phase:",
  "警告": "Warnings",
  "未提供错误详情。": "No error details were provided.",
  "正在分析...": "Analyzing...",
  "试听位置": "Preview Position",
  "播放头:": "Playhead:",
  "试听版本": "Preview Version",
  "试听控制": "Preview Controls",
  "原始音频": "Original Audio",
  "处理后": "Processed",
  "处理后 + 节拍轨": "Processed + Beat Track",
  "停止": "Stop",
  "准备中": "Preparing",
  "缓冲中": "Buffering",
  "播放中": "Playing",
  "已结束": "Ended",
  "播放失败": "Playback failed",
  "已停止": "Stopped",
  "正在准备试听片段...": "Preparing preview...",
  "正在缓冲试听...": "Buffering preview...",
  "试听中": "Previewing",
  "试听已结束": "Preview ended",
  "试听失败": "Preview failed",
  "手动校准": "Manual Calibration",
  "首拍(秒):": "First beat (sec):",
  "自动首拍参考(秒):": "Auto first-beat reference (sec):",
  "未锁定": "Unlocked",
  "提前半拍": "Half a beat earlier",
  "自动": "Auto",
  "延后半拍": "Half a beat later",
  "裁剪": "Trim",
  "入点(秒):": "In point (sec):",
  "出点(秒):": "Out point (sec):",
  "试听中修改首拍或相位，会从下一个节拍开始生效。":
    "Changes to the first beat or phase take effect from the next beat during preview.",
  "修改 BPM 或裁剪后，需重新开始试听。":
    "Restart preview after changing BPM or trim points.",
  "需校准 · 未锁定": "Needs calibration · Unlocked",
  "手动锁定": "Manually locked",
  "使用手动指定的歌曲首拍": "Using the manually specified first beat",
  "拍点精修": "Beat-refined",
  "全局锁定": "Globally locked",
  "需试听": "Preview advised",
  "稳定": "Stable",
  "中位误差 {value} ms": "Median error {value} ms",
  "映射 BPM 精修 {value}%": "Mapped BPM refinement {value}%",
  "减速超过 -20%，通常会明显影响听感": "Slowdown exceeds -20% and will usually have a noticeable effect on sound quality",
  "加速超过 +30%，可能明显影响听感": "Speed-up exceeds +30% and may noticeably affect sound quality",
  "减速幅度较大（低于 -15%）": "Large slowdown (below -15%)",
  "加速幅度较大（超过 +20%）": "Large speed-up (over +20%)",
  "全局 BPM 置信度较低，建议手动确认": "Overall BPM confidence is low; manual confirmation is recommended",
  "全局 BPM 置信度一般": "Overall BPM confidence is moderate",
  "未能自动锁定歌曲相位；综合质量已标记为“需校准”，请试听并手动设置歌曲首拍":
    "Track phase could not be locked automatically; overall quality is marked “Needs calibration”. Preview the track and set its first beat manually.",
  "歌曲拍点相位可靠性较低；综合质量已标记为“需校准”，建议手动设置歌曲首拍":
    "Beat-phase reliability is low; overall quality is marked “Needs calibration”. Setting the first beat manually is recommended.",
  "歌曲拍点相位一致性一般，综合质量已降级，建议试听确认":
    "Beat-phase consistency is moderate; overall quality has been downgraded. Preview the track to confirm.",

  "常规": "General",
  "节拍轨": "Beat Track",
  "项目属性页": "Project property pages",
  "名称:": "Name:",
  "将歌曲匹配到目标步频": "Match Tracks to Target Cadence",
  "目标步频:": "Target cadence:",
  "步频映射:": "Cadence mapping:",
  "自动判断": "Automatic",
  "一拍一步": "One step per beat",
  "一拍两步": "Two steps per beat",
  "设置新歌曲的自动匹配规则": "Automatic Matching Rules for New Tracks",
  "严格 (-4% / +6%)": "Strict (-4% / +6%)",
  "自然 (-6% / +10%)": "Natural (-6% / +10%)",
  "宽松 (-10% / +15%)": "Relaxed (-10% / +15%)",
  "良好 (-15% / +20%)": "Good (-15% / +20%)",
  "可接受 (-20% / +30%)": "Acceptable (-20% / +30%)",
  "不限": "Unlimited",
  "选择并试听全局节拍轨": "Select and Preview the Global Beat Track",
  "声音:": "Sound:",
  "柔和脚步": "Soft Footstep",
  "跑道脚步": "Track Footstep",
  "低频鼓点": "Low Kick",
  "木质打击": "Wood Block",
  "电子 Click": "Electronic Click",
  "自定义鼓点": "Custom Beat",
  "更换...": "Change...",
  "自定义...": "Custom...",
  "相对音量:": "Relative volume:",
  "重拍:": "Accent:",
  "无重拍": "No accent",
  "每 {count} 步": "Every {count} steps",
  "左右脚声道交替": "Alternate left/right channels",
  "应用": "Apply",

  "导出音频向导": "Export Audio Wizard",
  "选择要导出的内容": "Choose What to Export",
  "选择可选的封面视频": "Choose an Optional Cover Video",
  "选择格式和响度": "Choose Format and Loudness",
  "完成导出设置": "Complete Export Settings",
  "导出音频向导 - 第 {page} 页，共 {total} 页": "Export Audio Wizard - Page {page} of {total}",
  "导出内容": "Export Content",
  "连续跑步音乐（带节拍）": "Continuous Mix (With Beat)",
  "连续跑步音乐（不带节拍）": "Continuous Mix (No Beat)",
  "分别导出处理后的歌曲（带节拍）": "Separate Tracks (With Beat)",
  "分别导出处理后的歌曲（不带节拍）": "Separate Tracks (No Beat)",
  "封面视频（可选）": "Cover Video (Optional)",
  "选择一张图片后，合并音频会导出为带静态封面的 MP4；不选择则继续导出普通音频。":
    "Choose an image to export the continuous mix as an MP4 with a still cover. Leave it empty to export regular audio.",
  "封面图片:": "Cover image:",
  "未选择文件": "No file selected",
  "浏览...": "Browse...",
  "移除图片": "Remove Image",
  "支持 JPG、PNG、WebP，最大 20 MB。图片只在本机处理，不会上传；视频为 1920×1080，图片会等比缩放并留黑边。":
    "Supports JPG, PNG, and WebP up to 20 MB. The image is processed locally and never uploaded. Video is 1920×1080; the image is fitted with black bars.",
  "请选择有效的封面图片。": "Choose a valid cover image.",
  "封面图片不能超过 20 MB。": "The cover image must not exceed 20 MB.",
  "请选择 JPG、PNG 或 WebP 图片。": "Choose a JPG, PNG, or WebP image.",
  "音频格式": "Audio Format",
  "视频格式": "Video Format",
  "格式:": "Format:",
  "码率:": "Bit rate:",
  "音频码率:": "Audio bit rate:",
  "音频编码:": "Audio codec:",
  "响度": "Loudness",
  "目标:": "Target:",
  "响度标准化": "Normalize loudness",
  "同时导出 TXT / CSV 时间轴": "Also export TXT / CSV timeline",
  "导出摘要": "Export Summary",
  "项目:": "Project:",
  "内容:": "Content:",
  "歌曲:": "Tracks:",
  "封面:": "Cover:",
  "预计时长:": "Estimated duration:",
  "{count} 首": "{count}",
  "没有可导出的歌曲。请取消向导并在歌曲列表中勾选至少一首分析完成的歌曲。":
    "There are no exportable tracks. Cancel the wizard and select at least one analyzed track in the track list.",
  "一次最多导出 {limit} 首歌曲。当前已勾选 {count} 首，请取消向导并调整导出选择。":
    "You can export up to {limit} tracks at a time. {count} tracks are currently selected; cancel the wizard and adjust the export selection.",
  "{count} 首所选歌曲尚未就绪，不会导出。": "{count} selected tracks are not ready and will not be exported.",
  "< 上一步": "< Back",
  "下一步 >": "Next >",
  "完成": "Finish",
  "导出完成": "Export Complete",
  "无法完成导出": "Export Could Not Be Completed",
  "正在导出音频": "Exporting Audio",
  "正在生成封面视频": "Creating Cover Video",
  "加载 FFmpeg 并生成 MP4 封面视频": "Loading FFmpeg and creating the MP4 cover video",
  "加载 FFmpeg 并编码 MP3": "Loading FFmpeg and encoding MP3",
  "完成 WAV 文件": "Finalizing the WAV file",
  "编码 WAV": "Encoding WAV",
  "启用低内存分块导出": "Using low-memory chunked export",
  "混合时间线和固定节拍": "Mixing the timeline and fixed beat track",
  "混合时间线": "Mixing the timeline",
  "第一遍：测量纯歌曲响度与真峰值": "Pass 1: Measuring music-only loudness and true peak",
  "第二遍：测量标准化歌曲与节拍的最终真峰值": "Pass 2: Measuring the final true peak of normalized music and beat",
  "第三遍：写入峰值保护后的歌曲与节拍": "Pass 3: Writing peak-protected music and beat",
  "第二遍：写入标准化歌曲": "Pass 2: Writing normalized music",
  "流式打包视频与时间轴": "Streaming video and timelines into the archive",
  "流式打包音频与时间轴": "Streaming audio and timelines into the archive",
  "文件已开始下载。最终时长 {duration}。": "The download has started. Final duration: {duration}.",
  "正在准备...": "Preparing...",
  "重试": "Retry",

  "部分歌曲需要重新关联原始文件。": "Some tracks need their original files relinked.",
  "重新关联...": "Relink...",
  "歌曲列表": "Track List",
  "删除歌曲": "Delete Tracks",
  "要从项目中删除“{name}”吗？原始音乐文件不会被删除。":
    "Remove “{name}” from the project? The original music file will not be deleted.",
  "要从项目中删除所选的 {count} 首歌曲吗？原始音乐文件不会被删除。":
    "Remove the {count} selected tracks from the project? The original music files will not be deleted.",
  "所选歌曲": "selected track",
  "当前未保存的更改也会丢失。": "Current unsaved changes will also be lost.",
  "此操作无法撤销。": "This action cannot be undone.",
  "要永久删除“{name}”吗？{detail}": "Permanently delete “{name}”? {detail}",
  "是否保存对“{name}”所做的更改？": "Save changes to “{name}”?",
  "是(Y)": "Yes(Y)",
  "否(N)": "No(N)",
  "项目文件无效。": "The project file is invalid.",
  "项目删除失败。": "The project could not be deleted.",
  "项目文件已导入；包含歌曲的项目会自动加入本地项目列表。":
    "Project file imported. Projects containing tracks are added to the local project list automatically.",
  "{name} 副本": "Copy of {name}",
  "正在加载 RunBeat…": "Loading RunBeat…",

  "设置项目在标题栏、本地项目列表和导出文件名中使用的名称。":
    "Set the name used in the title bar, local project list, and export filenames.",
  "设置希望保持的每分钟步数，范围为 60～230 SPM。歌曲会保持音高，并调整速度以匹配这个节奏。":
    "Set the desired steps per minute, from 60 to 230 SPM. Tracks keep their pitch while their speed is adjusted to match this cadence.",
  "决定一个音乐拍点对应一步还是两步。自动判断会选择变速更小的合理映射。":
    "Choose whether one music beat represents one or two steps. Automatic selects a reasonable mapping with the smaller tempo change.",
  "决定新分析歌曲默认加入导出的非对称变速范围：减速侧更严格，加速侧更宽松；不会覆盖之后的手动选择。":
    "Set the asymmetric tempo range for automatically including newly analyzed tracks: slowdown is stricter and speed-up is more permissive. Later manual choices are not overwritten.",
  "选择叠加到音乐上的全局脚步提示。可以先播放六秒独立节拍进行试听。":
    "Choose the global footstep cue mixed over the music. You can preview six seconds of the beat by itself.",
  "调整节拍相对于标准化歌曲的音量，范围 -40～+10 dB；默认 -10 dB，最高值比默认突出 20 dB。":
    "Adjust the beat relative to the normalized music from -40 to +10 dB; -10 dB is the default, and the maximum is 20 dB more prominent than the default.",
  "按固定步数播放更明显的重拍；选择“无重拍”可保持每一步相同。":
    "Play a stronger accent at a fixed step interval; choose No accent to keep every step identical.",
  "在左右声道之间交替播放脚步提示，帮助区分左右脚。":
    "Alternate the footstep cue between left and right channels to distinguish each foot.",
  "连续模式生成一条完整跑步音乐，分别导出会生成独立歌曲；两种模式都可选择是否加入节拍轨。":
    "Continuous export creates one complete mix; separate export creates one file per track. Either mode can include or omit the beat track.",
  "连续模式可选择一张本地图片，将完整混音生成带静态封面的 MP4；图片不会上传或保存进项目。":
    "Continuous export can use a local image to create an MP4 of the full mix with a still cover. The image is not uploaded or saved in the project.",
  "MP3 文件较小；WAV 无损但体积较大。": "MP3 files are smaller; WAV is lossless but larger.",
  "响度标准化会让不同歌曲听起来更一致，但不能代替安全音量设置。":
    "Loudness normalization makes tracks sound more consistent, but does not replace a safe listening volume.",
  "单击选择歌曲，Ctrl 或 Shift 可多选。双击试听带节拍轨的处理后歌曲，Delete 删除所选歌曲。":
    "Click to select a track; use Ctrl or Shift for multiple selection. Double-click to preview the processed track with its beat track, and Delete to remove selected tracks.",
  "单击选择歌曲，Ctrl 或 Shift 可多选。双击试听带节拍轨的处理后歌曲，Delete 删除所选歌曲。单击列标题可排序；“变速”列按带正负号的百分比排序。右键单击列标题可隐藏或恢复数据列。":
    "Click to select a track; use Ctrl or Shift for multiple selection. Double-click to preview the processed track with its beat track, or Delete to remove selected tracks. Click a column header to sort; Tempo Change uses its signed percentage. Right-click a column header to hide or restore data columns.",
  "试听会从播放头连续播放到裁剪出点。首拍框中的灰色数值是自动参考；输入手动值会覆盖它，清空后恢复自动。播放中修改首拍或半拍相位会直接更新后续节拍。":
    "Preview plays continuously from the playhead to the trim out point. The gray first-beat value is the automatic reference; entering a manual value overrides it, and clearing the field restores automatic alignment. First-beat and half-beat changes update future beats immediately during playback."
};

function readInitialLanguage(): AppLanguage {
  try {
    return localStorage.getItem(LANGUAGE_STORAGE_KEY) === "en" ? "en" : "zh-CN";
  } catch {
    return "zh-CN";
  }
}

function interpolate(template: string, values?: TranslationValues): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => String(values[key] ?? match));
}

function translateRuntimeMessage(message: string, language: AppLanguage): string {
  if (language === "zh-CN" || !message) return message;
  const exact = ENGLISH[message];
  if (exact) return exact;

  const replacements: Array<[RegExp, string]> = [
    [/^项目已保存。$/, "Project saved."],
    [/^项目已另存为“(.+)”。$/, "Project saved as “$1”."],
    [/^已按 -(.+)% \/ \+(.+)% 变速范围重新选择歌曲。$/, "Track selection reset using a -$1% / +$2% tempo range."],
    [/^已按不限变速范围重新选择歌曲。$/, "Track selection reset with no tempo limit."],
    [/^已启用自定义鼓点：(.+)$/, "Custom beat enabled: $1"],
    [/^已重新关联 (\d+) 首歌曲。$/, "$1 tracks relinked."],
    [/^正在分析其他歌曲，请等待当前任务完成。$/, "Another analysis is already running. Wait for it to finish before starting a new one."],
    [/^分析进行中；请等待任务完成后再修改项目。$/, "Analysis is in progress. Wait for it to finish before editing the project."],
    [/^已撤销上一步操作。$/, "Undid the last action."],
    [/^已重做上一步操作。$/, "Redid the last action."],
    [/^(\d+) 首歌曲缺少原始文件，已跳过。$/, "$1 tracks were skipped because their original files are missing."],
    [/^重新分析完成：(\d+)\/(\d+) 首歌曲成功。$/, "Reanalysis complete: $1/$2 tracks succeeded."],
    [/^已过滤 (\d+) 首重复歌曲。$/, "Duplicate tracks skipped: $1."],
    [/^已过滤 (\d+) 首重复歌曲；没有其他可导入文件。$/, "Duplicate tracks skipped: $1; no other files can be imported."],
    [/^一次最多导出 (\d+) 首歌曲，当前已勾选 (\d+) 首$/, "You can export up to $1 tracks at a time; $2 tracks are currently selected."],
    [/^没有找到这个本地项目，已创建新项目。$/, "The local project was not found. A new project was created."],
    [/^请先重新关联 (.+) 的原始文件，再重新分析。$/, "Relink the original file for $1 before reanalyzing."],
    [/^(.+) 已重新分析。$/, "$1 was reanalyzed."],
    [/^(\d+) 路并行 · 解码 (.+)$/, "$1 parallel workers · Decoding $2"],
    [/^解码 (.+)$/, "Decoding $1"],
    [/^(\d+) 路并行 · 保持音高变速 (.+)$/, "$1 parallel workers · Pitch-preserving stretch · $2"],
    [/^保持音高变速 (.+)$/, "Pitch-preserving stretch · $1"],
    [/^已处理 (\d+) \/ (\d+) 首$/, "Processed $1 / $2 tracks"],
    [/^(\d+) 路并行 · 处理 (\d+) \/ (\d+) · (.+)$/, "$1 parallel workers · Processing $2 / $3 · $4"],
    [/^处理 (\d+) \/ (\d+) · (.+)$/, "Processing $1 / $2 · $3"],
    [/^编码 MP3 (\d+) \/ (\d+)$/, "Encoding MP3 $1 / $2"],
    [/^写入 WAV (\d+) \/ (\d+)$/, "Writing WAV $1 / $2"],
    [/^打包 (\d+) 首 ([A-Z0-9]+)$/, "Packaging $1 $2 tracks"],
    [/^纯歌曲响度预扫描 (\d+) \/ (\d+) · (.+)$/, "Music-only loudness pre-scan $1 / $2 · $3"],
    [/^标准化歌曲与节拍峰值预扫描 (\d+) \/ (\d+) · (.+)$/, "Normalized music and beat peak pre-scan $1 / $2 · $3"],
    [/^低内存最终渲染 (\d+) \/ (\d+) · (.+)$/, "Low-memory final render $1 / $2 · $3"],
    [/^纯歌曲响度测量完成(.*)$/, "Music-only loudness measurement complete$1"],
    [/^编码 MP3（(\d+) kbps）$/, "Encoding MP3 ($1 kbps)"],
    [/^生成 MP4 封面视频（AAC (\d+) kbps）$/, "Creating MP4 cover video (AAC $1 kbps)"],
    [/^MP4 编码失败（FFmpeg 退出码 (\d+)）：(.+)$/, "MP4 encoding failed (FFmpeg exit code $1): $2"],
    [/^MP4 编码失败（FFmpeg 退出码 (\d+)）$/, "MP4 encoding failed (FFmpeg exit code $1)"],
    [/^不支持的视频音频码率：(\d+) kbps$/, "Unsupported video audio bit rate: $1 kbps"],
    [/^FFmpeg 无法挂载封面或音频输入$/, "FFmpeg could not mount the cover image or audio input."],
    [/^FFmpeg 未返回有效的 MP4 数据$/, "FFmpeg did not return valid MP4 data."],
    [/^MP4 编码已取消$/, "MP4 encoding was canceled."],
    [/^自动保存失败：(.+)$/, "Autosave failed: $1"],
    [/^保存失败：(.+)$/, "Save failed: $1"]
  ];
  for (const [pattern, replacement] of replacements) {
    if (pattern.test(message)) return message.replace(pattern, replacement);
  }
  return message;
}

const I18nContext = createContext<I18nValue | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<AppLanguage>(readInitialLanguage);

  const setLanguage = useCallback((nextLanguage: AppLanguage) => {
    setLanguageState(nextLanguage);
    try {
      localStorage.setItem(LANGUAGE_STORAGE_KEY, nextLanguage);
    } catch {
      // Language remains session-local when storage is unavailable.
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const value = useMemo<I18nValue>(() => ({
    language,
    setLanguage,
    t: (source, values) => interpolate(language === "en" ? ENGLISH[source] ?? source : source, values),
    translateMessage: (message = "") => translateRuntimeMessage(message, language)
  }), [language, setLanguage]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// The hook intentionally lives with its provider so all translation behavior
// has a single public module.
// eslint-disable-next-line react-refresh/only-export-components
export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n must be used inside LanguageProvider");
  return value;
}
