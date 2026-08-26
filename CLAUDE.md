# CLAUDE.md

Hướng dẫn chạy và sửa project này nằm ở **[AGENTS.md](AGENTS.md)** — đọc file đó trước khi làm gì.

Tóm tắt: `./run-age.sh` (cần `age-config.json`). Đừng chạy thẳng `age-script.jsx` khi
chưa có config — script sẽ mở dialog và treo.

**BẮT BUỘC:** trước mỗi lần chạy script, phải dùng `AskUserQuestion` hỏi người dùng
theo 2 vòng — vòng 1: chọn thư mục template PSD; vòng 2: khoảng năm, tháng nào,
công thức tên file, thư mục output — rồi ghi `age-config.json` theo câu trả lời.
Không tự chạy config có sẵn, không tự chọn folder PSD kể cả khi chỉ có một.
Chi tiết ở mục "BẮT BUỘC — hỏi người dùng trước khi chạy" trong [AGENTS.md](AGENTS.md).

**NAS:** PSD nằm trên NAS. Chạy `./nas-mount.sh` để mount — tự thử LAN
(`192.168.1.32:5005`) → Tailscale (`100.117.91.92:5005`) → WebDAV public. Cổng WebDAV
là **5005**, không phải 5000. Credentials ở `.env`.

Cho người dùng duyệt chọn thư mục **theo từng cấp** (đừng quét đệ quy toàn NAS — WebDAV
chậm). Ghi vào config bằng placeholder `[NAS]/đường/dẫn`, **không ghi cứng mount point**
— vì mount point đổi theo tuyến, config sẽ hỏng khi chạy ở máy khác. `run-age.sh` tự
thay `[NAS]` lúc chạy.

**Windows:** dùng `nas-mount.bat` (SMB/UNC, fallback map ổ WebDAV) — phần này **chưa
được chạy thử**, smoke test kỹ ở lần chạy đầu.
