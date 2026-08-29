# Chạy age-script.jsx bằng AI agent / CLI

Script gốc luôn mở dialog ScriptUI — agent không click được nên sẽ treo vô hạn.
Đã thêm **chế độ headless**: có file config JSON → bỏ qua dialog, chạy thẳng, ghi log ra file.

## Cách chạy

Windows: `run-age.bat` — macOS: `run-age.sh`. Cùng config, cùng exit code.

```bat
copy age-config.example.json age-config.json
run-age.bat
run-age.bat duong\dan\config-khac.json
```

```bash
cp age-config.example.json age-config.json
./run-age.sh
./run-age.sh /duong/dan/config-khac.json
```

Exit code: `0` xong · `1` thiếu config / không thấy Photoshop · `2` quá thời gian chờ
(Windows) · `3` script lỗi. Log ở `age-run.log`, trạng thái cuối ở `age-run.done`.

### Khác biệt hai nền tảng

|  | macOS | Windows |
|---|---|---|
| Gọi Photoshop | `osascript ... do javascript` | `Photoshop.exe -r` |
| Truyền config | tham số `with arguments` | file trỏ `age-config-path.txt` |
| Biết lúc nào xong | osascript chạy đồng bộ | poll file `age-run.done` |
| Dò Photoshop | `/Applications/Adobe Photoshop*` | `%ProgramFiles%\Adobe\Adobe Photoshop*`, đè bằng `AGE_PS_EXE` |

Khi Photoshop lỗi, timeout hoặc không ghi `OK`, wrapper tự đóng Photoshop và chạy lại
tối đa 3 lần tổng cộng. `AGE_MAX_RETRIES=2` là mặc định (2 lần retry). Các ảnh đã xuất
được bỏ qua khi chạy lại, nên job tiếp tục từ phần còn thiếu.

## Config

| Key | Bắt buộc | Mặc định | Ghi chú |
|---|---|---|---|
| `fromYear` | có | — | Năm bắt đầu, 4 chữ số |
| `toYear` | có | — | Năm kết thúc, phải ≥ `fromYear` |
| `templateFolder` | không | tự dò `psd/` → `PTS/` → thư mục script | Tương đối = so với thư mục chứa script |
| `outputFolder` | không | `Result/` | Tự tạo nếu chưa có |
| `outputFormula` | không | `[mm]-[year]` | Token: `[month]`=January, `[m]`=1, `[mm]`=01, `[year]`=2026, `[yy]`=26 |
| `months` | không | tự dò theo số trong tên file | `{"1": "1.psd", "3": "3.psd"}` — tháng không khai báo sẽ bị **bỏ qua** |

Bỏ hẳn key `months` → script tự khớp `1.psd`→tháng 1 … `12.psd`→tháng 12.

## Script làm gì

Với mỗi tháng có template: mở PSD **1 lần**, set layer `month` = tên tháng tiếng Anh,
rồi lặp qua từng năm — set layer `year` = năm, layer `quote` = câu gốc với số đầu tiên
thay bằng tuổi (`năm hiện tại − year`) — export PNG, xong mới đóng file.

Ví dụ `1.psd` + `fromYear: 1990`: → `JANUARY` / `1990` / `36 YEARS OF MOSTLY SUNSHINE`.

## Cơ chế truyền config (quan trọng)

Thứ tự ưu tiên trong `getConfigFile()`:

1. Tham số `osascript ... with arguments {"/path/config.json"}` ← `run-age.sh` dùng
2. Biến môi trường `AGE_CONFIG`
3. File trỏ `age-config-path.txt` ← `run-age.bat` dùng (đọc xong script tự xoá)
4. `./age-config.json`

**Không dựa vào env var:** Photoshop thường đã chạy sẵn từ trước nên không thừa hưởng
môi trường của shell gọi lệnh. Tham số osascript (macOS) và file trỏ (Windows) mới là
đường đáng tin cậy — `Photoshop.exe -r` không có chỗ nhận tham số.

## Lưu ý cho agent

- Không có config → script mở dialog và **treo**. Luôn kiểm tra file config tồn tại trước.
- Headless bật `app.displayDialogs = DialogModes.NO`; mọi `alert()` được thay bằng ghi
  `age-run.log` (ghi đè mỗi lần chạy).
- Khối lượng lớn: 1956→2006 × 12 tháng = **612 ảnh**, chạy rất lâu. Test trước bằng
  config nhỏ (1 tháng, 1 năm).
- Photoshop bị chiếm dụng trong lúc chạy; không thao tác tay song song.
