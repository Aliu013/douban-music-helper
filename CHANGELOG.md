# Changelog

本文件记录从 Git/GitHub 正式维护开始后的版本变化。

## [1.0.1] - 2026-09-08

### Fixed
- 将 Bandcamp 的默认音乐风格从 `Electronic` 调整为 `Rock`。
- Bandcamp 曲目列表只采集标题，不再混入每首歌的播放时长。
- Bandcamp Description 在存在有效 about 时合并完整简介与 credits；仅含链接的 about 则改用 credits 中的制作与授权信息。

## [1.0.0] - 2026-09-08

### Added
- 将项目以 `douban-music-helper` 名称正式迁移到 Git/GitHub 管理。
- 明确支持网易云音乐、Bandcamp、Discogs 与 Apple Music 等来源。

### Fixed
- 保留并整合现有网易云音乐页面采集逻辑。
- 对网易云部分特殊专辑，曲目名优先读取干净的 `b[title]` 属性，避免 DOM 内随机干扰字符污染提取结果。
- 将曲目标题中的不换行空格（U+00A0 / `&nbsp;`）规范化为普通空格。

### Notes
- v1.0.0 是正式 Git 版本历史的起点。
- 在此之前存在若干未完整保存的本地/实验版本，已知包括部分 0.3.x 版本，因此不将其作为完整 Git 历史重建。
