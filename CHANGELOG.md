# Changelog

本文件记录从 Git/GitHub 正式维护开始后的版本变化。

## [Unreleased]

### Added
- 网易云音乐专辑页会采集专辑名下方的副标题，并填入豆瓣音乐条目的“又名”字段；没有副标题时保持为空。
- 网易云音乐专辑的表演者超过三个时，会自动增加豆瓣表演者输入框并填写全部已采集的表演者。

## [1.0.1] - 2026-09-08

### Fixed
- 将 Bandcamp 的默认音乐风格从 `Electronic` 调整为 `Rock`。
- Bandcamp 曲目列表只采集标题，不再混入每首歌的播放时长。
- Bandcamp Description 在存在有效 about 时直接拼接完整 credits；仅含链接的 about 则忽略链接并保留完整 credits。
- Bandcamp 的 Collect 按钮固定在视口左上角，滚动页面后仍然可见。

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
