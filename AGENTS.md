# AGENTS.md — hướng dẫn cho AI agent

Project này sinh ảnh PNG hàng loạt từ template Photoshop (.psd).
**Trước mỗi lần chạy, bạn PHẢI hỏi người dùng để điền config** (xem mục ngay dưới).
Đọc hết file trước khi chạy.

## BẮT BUỘC — hỏi người dùng trước khi chạy

**Mỗi lần chuẩn bị chạy script, agent PHẢI hỏi người dùng để điền `age-config.json`
trước, không được tự chạy config có sẵn.** Dùng công cụ hỏi tương tác (`AskUserQuestion`
với Claude Code) — không đoán, không dùng giá trị mặc định thay câu trả lời.

Hỏi làm **2 vòng** (vì danh sách tháng phụ thuộc folder PSD nào được chọn):

### Vòng 1 — thư mục template PSD (trên NAS)

PSD nằm trên NAS. **Mount NAS trước**, rồi cho người dùng duyệt chọn thư mục:

```bash
MOUNT_POINT=$(./nas-mount.sh)    # macOS  → /Volumes/...
```
```bat
for /f "delims=" %B in ('nas-mount.bat') do set "NAS_BASE=%B"   REM Windows → \\host hoặc Z:
```

Exit 2 = không tuyến nào vào được. Cả hai script thử lần lượt LAN → Tailscale →
WebDAV public (khai báo ở `.env`), đã kết nối sẵn thì dùng lại nên gọi nhiều lần vô hại.

macOS mount WebDAV lên `/Volumes/`; Windows dùng SMB/UNC (`\\192.168.1.32`) vì SMB
native và nhanh hơn trên LAN, chỉ khi SMB không được mới map ổ đĩa WebDAV.

**Duyệt theo từng cấp, không quét đệ quy toàn NAS** — WebDAV chậm, quét cả cây sẽ
treo rất lâu. Cách làm:

1. `ls "$MOUNT_POINT"` → hỏi người dùng chọn thư mục cấp 1.
2. Với thư mục đang đứng: `ls` ra thư mục con **và** đếm `.psd` ngay trong nó.
   Hỏi người dùng: *dùng luôn thư mục này* (nếu có `.psd`) hay *đi tiếp vào thư mục con nào*.
3. Lặp lại bước 2 cho tới khi người dùng chốt. Mỗi lựa chọn ghi rõ số file `.psd`
   ở trong để người dùng biết thư mục nào là template thật.

**Không được tự chọn** kể cả khi chỉ có một thư mục có `.psd` — vẫn hỏi để xác nhận.

#### Ghi `templateFolder` bằng `[NAS]`, KHÔNG ghi mount point thật

Gốc đường dẫn đổi theo máy và theo tuyến — macOS `/Volumes/100.117.91.92`,
Windows `\\192.168.1.32` hoặc `Z:`. Config tạo ở máy này mà ghi cứng gốc đó thì sang
máy khác sẽ sai đường dẫn.

Nên khi ghi config, **cắt bỏ phần mount point, thay bằng `[NAS]`**:

```jsonc
// chọn: /Volumes/100.117.91.92/Team Media/THANG 1
"templateFolder": "[NAS]/Team Media/THANG 1"
```

`run-age.sh` / `run-age.bat` thấy `[NAS]` sẽ tự kết nối NAS rồi thay bằng gốc thật lúc chạy
(ghi ra `.age-config-resolved.json`, không đụng vào config gốc). Áp dụng cho cả
`outputFolder` nếu muốn xuất ảnh thẳng lên NAS.

Nếu `nas-mount.sh` exit 2: dừng lại, báo người dùng kiểm tra mạng / tailscale /
credentials trong `.env` — đừng fallback im lặng sang thư mục `psd/` local.

### Vòng 2 — 4 câu còn lại

Quét `.psd` trong folder vừa chọn, rồi hỏi gộp trong **một** lần:

1. **Khoảng năm** — `fromYear` và `toYear`. Nhắc rõ số ảnh sẽ sinh ra
   = (toYear − fromYear + 1) × số tháng chọn. Gợi ý vài lựa chọn sẵn
   (vd. `1990–1990` để test, `1956–2006` = full) + để người dùng tự nhập.
2. **Tháng nào** — tất cả, hay chỉ một số tháng (multiSelect). Chỉ liệt kê những tháng
   **có file `.psd` thật** trong folder đã chọn ở vòng 1; tháng không có file thì không đưa ra.
3. **Tên file output** — `outputFormula`. Gợi ý `[mm]-[year]`, `[month]-[year]`,
   `[mm]-[yy]`; giải thích placeholder.
4. **Thư mục output** — `outputFolder`, mặc định gợi ý `Result`. Nếu thư mục đã có
   ảnh cũ, nói rõ ảnh trùng tên sẽ bị ghi đè.

### Sau khi có đủ câu trả lời

1. Ghi đè `age-config.json` bằng đúng giá trị người dùng chọn (đủ 6 key:
   `templateFolder`, `fromYear`, `toYear`, `outputFormula`, `outputFolder`, `months`).
2. **Đọc lại config vừa ghi và tóm tắt cho người dùng** (folder PSD, khoảng năm,
   số tháng, tổng số ảnh, thư mục output), rồi mới chạy wrapper.
3. Nếu tổng số ảnh > 50, chạy smoke test 1 tháng × 1 năm trước (xem mục dưới),
   báo kết quả, chờ người dùng xác nhận rồi mới chạy full.

Chỉ được bỏ qua câu hỏi nào mà người dùng đã nói thẳng trong câu lệnh
(vd. "chạy psd/ từ 1990 đến 1995, chỉ tháng 3") — các câu còn lại vẫn phải hỏi,
và vẫn tóm tắt lại config trước khi chạy.

## Chạy như thế nào

**Windows** (PowerShell hoặc cmd):

```bat
REM age-config.json phải được tạo từ câu trả lời của người dùng, KHÔNG copy example
run-age.bat
```

**macOS**:

```bash
# age-config.json phải được tạo từ câu trả lời của người dùng, KHÔNG copy example
./run-age.sh
```

Cả hai wrapper dùng chung config và trả về exit code giống nhau:

| Exit code | Nghĩa |
|---|---|
| 0 | Xong, ảnh nằm trong `Result/` |
| 1 | Không tìm thấy config hoặc không tìm thấy Photoshop |
| 2 | Quá thời gian chờ (chỉ Windows) — Photoshop có thể đang kẹt ở hộp thoại nào đó |
| 3 | Script chạy nhưng lỗi — đọc `age-run.log` để biết lý do |

**Đừng chỉ nhìn "lệnh chạy xong" mà kết luận thành công — phải xem exit code.**
Log ở `age-run.log`, trạng thái cuối (`OK`/`ERROR`) ở `age-run.done`.

## CẢNH BÁO — đừng làm những việc sau

| Đừng | Vì sao |
|---|---|
| Chạy thẳng `age-script.jsx` khi không có file config | Script mở hộp thoại ScriptUI, bạn không click được → **treo vô hạn** |
| Chạy config mặc định để "thử xem có được không" | 1956→2006 × 12 tháng = **612 ảnh**, mất rất lâu và chiếm Photoshop suốt thời gian đó |
| Xoá `Result/` | Có thể chứa ảnh người dùng đã xuất trước đó |

**Luôn smoke test trước** bằng config nhỏ 1 tháng × 1 năm, xem ảnh kết quả rồi mới chạy full:

Nội dung config smoke test — lưu thành `smoke.json` cạnh script:

```json
{ "fromYear": 1990, "toYear": 1990, "templateFolder": "psd",
  "outputFormula": "SMOKETEST-[mm]-[year]", "months": { "1": "1.psd" } }
```

Chạy `run-age.bat smoke.json` (Windows) hoặc `./run-age.sh smoke.json` (macOS),
**mở xem** `Result/SMOKETEST-01-1990.png` để xác nhận chữ đúng, rồi xoá ảnh và
`smoke.json` đi trước khi chạy full.

## Config (`age-config.json`)

| Key | Bắt buộc | Mặc định | Ghi chú |
|---|---|---|---|
| `fromYear` | có | — | Năm bắt đầu, 4 chữ số |
| `toYear` | có | — | Phải ≥ `fromYear` |
| `templateFolder` | **có** (khi dùng NAS) | tự dò `psd/` → `PTS/` → thư mục script | Dùng `[NAS]/đường/dẫn` cho thư mục trên NAS — `run-age.sh` tự thay bằng mount point. Đường dẫn tương đối = so với thư mục chứa script |
| `outputFolder` | không | `Result/` | Tự tạo nếu chưa có |
| `outputFormula` | không | `[mm]-[year]` | `[month]`=January, `[m]`=1, `[mm]`=01, `[year]`=2026, `[yy]`=26 |
| `months` | không | tự dò số trong tên file | `{"1":"1.psd","3":"3.psd"}` — tháng không khai báo bị **bỏ qua** |

## Script làm gì

Mỗi tháng có template: mở PSD **1 lần** → set layer `month` = tên tháng tiếng Anh →
lặp từng năm (set layer `year`, set layer `quote` = câu gốc với số đầu tiên thay bằng
tuổi = năm hiện tại − year) → export PNG → đóng file.

Kết quả mong đợi với `1.psd` + năm 1990 (chạy năm 2026):
`JANUARY` / `1990` / `36 YEARS OF MOSTLY SUNSHINE`.

Template PSD **bắt buộc** có layer text tên `month`, `year`, `quote`. Thiếu layer nào
thì phần đó không được thay, script vẫn chạy và export bình thường — nên nếu ảnh ra
sai nội dung, kiểm tra tên layer trong PSD trước tiên.

## Yêu cầu môi trường

Cần Adobe Photoshop đã cài. Wrapper tự dò đường dẫn cài đặt.

### NAS (nơi chứa PSD)

> **Ưu tiên chạy local**: nếu PSD nằm trên NAS, tải PSD + font về `local-run/age/PTS/` trước,
> ghi config trỏ local, chạy, rồi upload kết quả lên NAS — đừng để Photoshop đọc/ghi trực
> tiếp qua WebDAV (rất chậm).

Fast-path thực hiện workflow này trên cả macOS và Windows; Windows chỉ khác ở cách gọi
Photoshop bằng `run-age.bat`.

Credentials trong `.env` (copy từ `.env.example`, **không commit**). `nas-mount.sh` mount
NAS lên `/Volumes/` bằng WebDAV để Photoshop mở PSD như file local.

Ba tuyến vào NAS, thử theo thứ tự — tuyến nào không với tới được thì bỏ qua ngay:

| Biến | Tuyến | Khi nào dùng được |
|---|---|---|
| `NAS_URL_1` | LAN `192.168.1.32:5005` | máy ở cùng mạng công ty — nhanh nhất |
| `NAS_URL_2` | Tailscale `100.117.91.92:5005` | máy đã join tailnet, ở đâu cũng được |
| `NAS_URL_3` | WebDAV public `nas-api.batmedia.info` | fallback cuối, không cần tailscale |

**Cổng WebDAV của NAS là 5005, không phải 5000.** 5000 là giao diện DSM — đã kiểm chứng:
PROPFIND vào 5005 trả `207`, vào 5000 trả `200` (trang HTML login).

Tuyến chết được loại bằng PROPFIND có timeout (`NAS_PROBE_TIMEOUT`, mặc định 4s) nên
không bị treo khi ở ngoài mạng.

**Trên macOS đừng dùng SMB.** Cổng 445 có mở, nhưng đo thực tế qua Tailscale:
SMB `0.42 MB/s` so với WebDAV public `2.0 MB/s` — chậm hơn ~5 lần vì SMB rất nhạy với
độ trễ WAN. Ngược lại trên Windows ở LAN thì SMB là lựa chọn tốt nhất (native, không
cần dịch vụ WebClient), nên `nas-mount.bat` ưu tiên SMB.

Windows cần thêm `NAS_SMB_1` / `NAS_SMB_2` trong `.env` (chỉ hostname, không cổng).
Nếu phải rơi xuống WebDAV, Windows cần dịch vụ **WebClient** đang chạy (`sc start WebClient`).

> **Phần Windows chưa chạy thử.** `nas-mount.bat` và đoạn resolve `[NAS]` trong
> `run-age.bat` được viết nhưng chưa test được vì máy phát triển là macOS, không có
> PowerShell lẫn Windows. Chạy lần đầu trên máy Windows phải smoke test 1 tháng × 1 năm
> và đọc kỹ log trước khi chạy full.

**Đọc PSD qua WebDAV chậm hơn local rõ rệt** — càng nên smoke test trước khi chạy full.

### Windows

- `run-age.bat` dò `Photoshop.exe` trong `%ProgramFiles%\Adobe\Adobe Photoshop*`
  (ưu tiên bản mới nhất). Cài chỗ khác → đặt biến `AGE_PS_EXE` trỏ tới `Photoshop.exe`.
- Photoshop **không tự thoát** sau khi script xong, nên batch chờ bằng cách poll file
  `age-run.done`. Mặc định chờ tối đa 60 phút; đổi bằng biến `AGE_TIMEOUT_SEC`.
- Nếu Photoshop báo lỗi, timeout hoặc không ghi `OK` vào `age-run.done`, wrapper tự
  đóng Photoshop và thử lại tối đa 3 lần tổng cộng. Đổi số lần thử bằng
  `AGE_MAX_RETRIES` (mặc định `2` lần retry). Vì JSX bỏ qua ảnh đã tồn tại, lần thử
  lại sẽ tiếp tục phần còn thiếu, không chạy lại từ đầu.
- `Photoshop.exe -r` không truyền được tham số, nên batch ghi đường dẫn config vào
  `age-config-path.txt`; script đọc rồi tự xoá. Đừng commit hay sửa file tạm này.
- Nếu Photoshop đang mở sẵn với document chưa lưu, hộp thoại lưu file có thể chặn
  script → exit code 2. Đóng hết document trước khi chạy.

### macOS

- `run-age.sh` dò tên app trong `/Applications`.
- **Lần chạy đầu trên máy mới**: macOS hiện hộp thoại xin quyền "Terminal muốn điều
  khiển Adobe Photoshop". Đây là dialog hệ thống, **bạn không click được** — phải nhờ
  người dùng bấm OK một lần. Lỗi `-1743` / "Not authorized" chính là dấu hiệu: dừng
  lại, báo người dùng vào *System Settings → Privacy & Security → Automation*.

## Sửa code

`age-script.jsx` là ExtendScript (ES3) — **không có** `let/const`, arrow function,
`JSON.parse`, `Array.forEach`. Chỉ dùng cú pháp ES3.

Kiểm tra cú pháp không cần Photoshop:

```bash
sed '1d' age-script.jsx > /tmp/check.js && node --check /tmp/check.js
```
