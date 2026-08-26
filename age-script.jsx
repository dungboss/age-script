#target photoshop

'use strict';

// Tham số truyền từ osascript (`do javascript ... with arguments {...}`).
// PHẢI đọc ở scope script: bên trong function, `arguments` là của chính function đó.
var SCRIPT_ARGS = null;
try { SCRIPT_ARGS = arguments; } catch (e) {}

app.preferences.rulerUnits = Units.PIXELS;

var baseFolder = (new File($.fileName)).parent;
var outputFolder = new Folder(baseFolder.fsName + "/Result");

// Chế độ headless: có file config → chạy thẳng, không mở dialog (dành cho AI agent / CLI).
// Đường dẫn config lấy từ biến môi trường AGE_CONFIG, mặc định ./age-config.json
var configFile = getConfigFile();
var isHeadless = configFile !== null;
var logFile = new File(baseFolder.fsName + "/age-run.log");
// Photoshop vẫn mở sau khi script xong nên tiến trình gọi không biết lúc nào kết thúc.
// Script xoá file này lúc bắt đầu và ghi lại lúc xong → bên ngoài chỉ cần poll nó.
var doneFile = new File(baseFolder.fsName + "/age-run.done");

// Công thức đặt tên file output. Token trong ngoặc vuông được thay bằng giá trị của từng tháng;
// mọi ký tự khác giữ nguyên.
var DEFAULT_OUTPUT_FORMULA = "[mm]-[year]";

// Layer "month" luôn nhận tên tháng tiếng Anh, layer "year" luôn nhận năm 4 chữ số
var MONTH_NAMES_EN = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

// Năm dùng để tính tuổi trong layer "quote": tuổi = CURRENT_YEAR - year
var CURRENT_YEAR = (new Date()).getFullYear();

// Khoảng năm mặc định trong dialog
var DEFAULT_FROM_YEAR = 1956;
var DEFAULT_TO_YEAR = 2006;

var exportOptions = new ExportOptionsSaveForWeb();
exportOptions.quality = 100;
exportOptions.PNG8 = false;
exportOptions.format = SaveDocumentType.PNG;

runMain();

// Headless không được để lỗi nổi lên thành hộp thoại — bắt hết, ghi log, rồi báo xong
function runMain() {
  if (!isHeadless) {
    main();
    return;
  }

  var status = "OK";
  try {
    if (main() === false) {
      status = "ERROR";
    }
  } catch (e) {
    status = "ERROR";
    log("LỖI: " + e.message + (e.line ? " (dòng " + e.line + ")" : ""));
  }
  writeDoneFile(status);
}

function writeDoneFile(status) {
  try {
    doneFile.encoding = "UTF-8";
    doneFile.lineFeed = "Unix";
    if (doneFile.open("w")) {
      doneFile.writeln(status);
      doneFile.close();
    }
  } catch (e) {}
}

function main() {
  if (isHeadless) {
    // Không cho Photoshop bật bất kỳ hộp thoại nào — agent không click được
    app.displayDialogs = DialogModes.NO;
    resetLog();
    try { if (doneFile.exists) { doneFile.remove(); } } catch (e) {}
  } else {
    app.bringToFront();
  }

  if (!outputFolder.exists && !outputFolder.create()) {
    notify("Result folder cannot be created");
    return false;
  }

  var selection = isHeadless ? loadHeadlessSelection(configFile) : showSelectionDialog();
  if (!selection) {
    // Headless: config lỗi. Có dialog: người dùng bấm Cancel — không phải lỗi.
    return !isHeadless;
  }

  if (selection.toYear < selection.fromYear) {
    notify("Khoảng thời gian không hợp lệ.");
    return false;
  }

  // Mỗi template chỉ mở 1 lần: mở PSD tháng 1 → xuất hết các năm → đóng → sang tháng 2
  var skipped = [];
  var exported = 0;
  for (var month = 1; month <= 12; month++) {
    var template = selection.templates[month];
    if (!template) {
      skipped.push(String(month));
      continue;
    }
    var count = processMonth(month, template, selection);
    exported += count;
    log("Tháng " + month + " (" + decodeURI(template.name) + "): " + count + " ảnh");
  }

  var summary = "Đã xuất " + exported + " ảnh.";
  if (skipped.length > 0) {
    summary += "\nBỏ qua tháng chưa chọn template: " + skipped.join(", ");
  }
  notify(summary);
  return true;
}

// ---------------------------------------------------------------------------
// Headless mode — cấu hình bằng file JSON thay cho dialog
// ---------------------------------------------------------------------------

// Thứ tự ưu tiên: tham số osascript (`with arguments`) → biến môi trường AGE_CONFIG
// → ./age-config.json. Photoshop đang chạy sẵn KHÔNG thấy env của shell, nên tham số
// osascript là cách đáng tin cậy nhất khi gọi từ agent/CLI.
function getConfigFile() {
  var scriptFolder = (new File($.fileName)).parent;
  var candidates = [];

  if (SCRIPT_ARGS && SCRIPT_ARGS.length > 0 && SCRIPT_ARGS[0]) {
    candidates.push(String(SCRIPT_ARGS[0]));
  }

  try {
    var envPath = $.getenv("AGE_CONFIG");
    if (envPath) {
      candidates.push(envPath);
    }
  } catch (e2) {}

  // Windows: `Photoshop.exe -r script.jsx` không truyền được tham số, nên run-age.bat
  // ghi đường dẫn config vào file trỏ này. Script xoá file trỏ ngay sau khi đọc.
  var pointerFile = new File(scriptFolder.fsName + "/age-config-path.txt");
  if (pointerFile.exists) {
    pointerFile.encoding = "UTF-8";
    if (pointerFile.open("r")) {
      var pointed = trimString(pointerFile.read());
      pointerFile.close();
      if (pointed.length > 0) {
        candidates.push(pointed);
      }
    }
    try { pointerFile.remove(); } catch (e3) {}
  }

  candidates.push(scriptFolder.fsName + "/age-config.json");

  for (var i = 0; i < candidates.length; i++) {
    var path = trimString(candidates[i]);
    if (path.length === 0) {
      continue;
    }
    var file = new File(path);
    if (file.exists) {
      return file;
    }
  }
  return null;
}

// Đọc JSON config. Trả về object selection giống hệt dialog trả về, null nếu lỗi.
function loadHeadlessSelection(fileObj) {
  var config = readJsonFile(fileObj);
  if (!config) {
    return null;
  }

  var fromYear = parseInt(config.fromYear, 10);
  var toYear = parseInt(config.toYear, 10);
  if (isNaN(fromYear) || isNaN(toYear)) {
    notify("Config thiếu hoặc sai fromYear / toYear.");
    return null;
  }

  var templateFolder = config.templateFolder
    ? new Folder(resolveConfigPath(config.templateFolder))
    : getDefaultTemplateFolder();
  if (!templateFolder || !templateFolder.exists) {
    notify("Không tìm thấy templateFolder: " + config.templateFolder);
    return null;
  }

  var templateFiles = loadTemplateFiles(templateFolder);
  if (templateFiles.length === 0) {
    notify("Không có file .psd nào trong " + templateFolder.fsName);
    return null;
  }

  var templates = buildHeadlessTemplateMap(config.months, templateFolder, templateFiles);
  if (!templates) {
    return null;
  }

  if (config.outputFolder) {
    outputFolder = new Folder(resolveConfigPath(config.outputFolder));
    if (!outputFolder.exists && !outputFolder.create()) {
      notify("Không tạo được outputFolder: " + outputFolder.fsName);
      return null;
    }
  }

  var outputFormula = config.outputFormula ? trimString(config.outputFormula) : DEFAULT_OUTPUT_FORMULA;
  if (outputFormula.length === 0) {
    outputFormula = DEFAULT_OUTPUT_FORMULA;
  }

  log("Config: " + fileObj.fsName);
  log("Năm " + fromYear + " → " + toYear + " | template: " + templateFolder.fsName);
  log("Output: " + outputFolder.fsName + " | công thức: " + outputFormula);

  return {
    fromYear: fromYear,
    toYear: toYear,
    outputFormula: outputFormula,
    templates: templates
  };
}

// months: bỏ trống → tự dò theo số trong tên file. Có → { "1": "1.psd", "3": "/path/khac.psd" }.
// Tháng không khai báo (hoặc để null / "") sẽ bị bỏ qua.
function buildHeadlessTemplateMap(months, templateFolder, templateFiles) {
  var templates = {};
  var count = 0;

  for (var month = 1; month <= 12; month++) {
    var file = null;

    if (months) {
      var entry = months[String(month)];
      if (!entry || trimString(entry).length === 0) {
        continue;
      }
      // Tên file trần được hiểu là nằm trong templateFolder
      file = /[\/\\]/.test(entry)
        ? new File(resolveConfigPath(entry))
        : new File(templateFolder.fsName + "/" + entry);
      if (!file.exists) {
        notify("Không tìm thấy template tháng " + month + ": " + entry);
        return null;
      }
    } else {
      var index = findTemplateIndexByMonth(templateFiles, month);
      if (index === -1) {
        continue;
      }
      file = templateFiles[index];
    }

    if (!isPsdFile(file)) {
      notify("Template tháng " + month + " phải là file .psd: " + decodeURI(file.name));
      return null;
    }

    templates[month] = file;
    count++;
  }

  if (count === 0) {
    notify("Không có template nào để chạy. Kiểm tra lại \"months\" trong config.");
    return null;
  }
  return templates;
}

// ExtendScript không có JSON.parse — dùng eval trên object literal (config là file cục bộ, tin cậy)
function readJsonFile(fileObj) {
  fileObj.encoding = "UTF-8";
  if (!fileObj.open("r")) {
    notify("Không mở được config " + fileObj.fsName);
    return null;
  }
  var content = fileObj.read();
  fileObj.close();

  if (content.length > 0 && content.charCodeAt(0) === 0xFEFF) {
    content = content.substring(1);
  }

  try {
    return eval("(" + content + ")");
  } catch (e) {
    notify("Config không phải JSON hợp lệ: " + e.message);
    return null;
  }
}

// Đường dẫn tương đối trong config được hiểu là tương đối so với thư mục chứa script
function resolveConfigPath(path) {
  path = trimString(String(path));
  // Tuyệt đối: /unix, ~/home, C:\windows, C:/windows, \\\\máy-chủ\\chia-sẻ
  if (/^([~\/]|[A-Za-z]:|\\\\)/.test(path)) {
    return path;
  }
  return baseFolder.fsName + "/" + path;
}

// Headless thì alert() sẽ treo script → ghi log ra file + stdout
function notify(message) {
  if (isHeadless) {
    log(message);
    return;
  }
  alert(message);
}

function log(message) {
  try { $.writeln(message); } catch (e) {}
  if (!isHeadless) {
    return;
  }
  try {
    logFile.encoding = "UTF-8";
    logFile.lineFeed = "Unix";
    if (logFile.open("a")) {
      logFile.writeln(message);
      logFile.close();
    }
  } catch (e2) {}
}

function resetLog() {
  try {
    logFile.encoding = "UTF-8";
    logFile.lineFeed = "Unix";
    if (logFile.open("w")) {
      logFile.writeln("[" + (new Date()).toString() + "] AGE script bắt đầu");
      logFile.close();
    }
  } catch (e) {}
}

function showSelectionDialog() {
  var dialog = new Window("dialog", "Chọn khoảng thời gian và template");
  dialog.orientation = "column";
  dialog.alignChildren = "fill";
  dialog.spacing = 10;
  dialog.margins = 16;

  var message = dialog.add("statictext", undefined,
    "Chọn thư mục template, khoảng thời gian cần chạy, và template cho từng tháng.");
  message.maximumSize.width = 460;

  // --- Khoảng thời gian ---
  var rangePanel = dialog.add("panel", undefined, "Khoảng thời gian (mỗi năm chạy đủ 12 tháng)");
  rangePanel.orientation = "column";
  rangePanel.alignChildren = "left";
  rangePanel.spacing = 8;
  rangePanel.margins = 10;

  var fromRow = addYearRow(rangePanel, "Từ năm", DEFAULT_FROM_YEAR);
  var toRow = addYearRow(rangePanel, "Đến năm", DEFAULT_TO_YEAR);

  // --- Tên file output ---
  var formulaPanel = dialog.add("panel", undefined, "Tên file output");
  formulaPanel.orientation = "column";
  formulaPanel.alignChildren = "fill";
  formulaPanel.spacing = 6;
  formulaPanel.margins = 10;

  var formulaRow = formulaPanel.add("group");
  formulaRow.orientation = "row";
  formulaRow.alignChildren = ["left", "center"];
  formulaRow.spacing = 10;
  formulaRow.add("statictext", undefined, "Công thức:");
  var formulaField = formulaRow.add("edittext", undefined, DEFAULT_OUTPUT_FORMULA);
  formulaField.preferredSize.width = 380;

  var formulaHint = formulaPanel.add("statictext", undefined,
    "Token: [month] = January, [m] = 1, [mm] = 01, [year] = 2026, [yy] = 26.");
  formulaHint.maximumSize.width = 470;

  var formulaPreview = formulaPanel.add("statictext", undefined, "");
  formulaPreview.maximumSize.width = 470;

  function refreshFormulaPreview() {
    var period = { month: 1, year: parseYear(fromRow.yearField.text, DEFAULT_FROM_YEAR) };
    formulaPreview.text = "Ví dụ: " + buildOutputFileName(
      applyOutputNameFormula(formulaField.text, period)
    );
  }
  formulaField.onChanging = refreshFormulaPreview;
  fromRow.yearField.onChanging = refreshFormulaPreview;
  refreshFormulaPreview();

  // --- Thư mục template ---
  var templateFolderRow = addPathPickerRow(dialog, "Template folder", "folder");

  var defaultTemplateFolder = getDefaultTemplateFolder();
  if (defaultTemplateFolder) {
    templateFolderRow.value = defaultTemplateFolder;
    templateFolderRow.pathField.text = defaultTemplateFolder.fsName;
  }

  // --- Template cho từng tháng ---
  var templatePanel = dialog.add("panel", undefined, "Template theo tháng");
  templatePanel.orientation = "column";
  templatePanel.alignChildren = "fill";
  templatePanel.spacing = 8;
  templatePanel.margins = 10;

  var templateNote = templatePanel.add("statictext", undefined,
    "Mỗi tháng dùng 1 file PSD, tự dò theo số trong tên file (1.psd → tháng 1). Để trống để bỏ qua tháng đó.");
  templateNote.maximumSize.width = 460;

  var templateList = templatePanel.add("group");
  templateList.orientation = "column";
  templateList.alignChildren = "fill";
  templateList.spacing = 4;

  var currentTemplateFiles = [];
  if (defaultTemplateFolder && defaultTemplateFolder.exists) {
    currentTemplateFiles = loadTemplateFiles(defaultTemplateFolder);
  }

  var monthRows = [];
  for (var m = 1; m <= 12; m++) {
    monthRows.push(addMonthTemplateRow(templateList, m, currentTemplateFiles));
  }

  templateFolderRow.browseButton.onClick = function () {
    var folder = Folder.selectDialog("Select the template folder");
    if (!folder) {
      return;
    }
    templateFolderRow.value = folder;
    templateFolderRow.pathField.text = folder.fsName;

    currentTemplateFiles = loadTemplateFiles(folder);
    if (currentTemplateFiles.length === 0) {
      alert("No PSD files were found in the selected folder.");
      templateFolderRow.value = null;
      templateFolderRow.pathField.text = "";
    }
    populateMonthRowsTemplateFiles(monthRows, currentTemplateFiles);
    dialog.layout.layout(true);
  };

  var buttonGroup = dialog.add("group");
  buttonGroup.alignment = "right";
  var okButton = buttonGroup.add("button", undefined, "OK", { name: "ok" });
  var cancelButton = buttonGroup.add("button", undefined, "Cancel", { name: "cancel" });

  okButton.onClick = function () {
    dialog.close(1);
  };
  cancelButton.onClick = function () {
    dialog.close(0);
  };

  if (dialog.show() != 1) {
    return null;
  }

  var fromYear = parseYear(fromRow.yearField.text, 0);
  var toYear = parseYear(toRow.yearField.text, 0);

  if (!fromYear || !toYear) {
    alert("Năm không hợp lệ. Nhập năm dạng 4 chữ số, ví dụ 2026.");
    return null;
  }

  if (toYear < fromYear) {
    alert("\"Đến năm\" phải bằng hoặc sau \"Từ năm\".");
    return null;
  }

  var outputFormula = trimString(formulaField.text);
  if (outputFormula.length === 0) {
    alert("Vui lòng nhập công thức tên file output.");
    return null;
  }

  // Không có token nào → mọi tháng ra cùng 1 tên file và đè lên nhau
  if (!/\[(month|year|m|mm|yy)\]/i.test(outputFormula)) {
    if (!confirm("Công thức không chứa token nào ([month], [year], [mm], [yy]...).\n" +
      "Tất cả ảnh sẽ có cùng tên file và ghi đè lên nhau.\n\nVẫn tiếp tục?")) {
      return null;
    }
  }

  if (!templateFolderRow.value) {
    alert("Vui lòng chọn thư mục template.");
    return null;
  }

  if (!templateFolderRow.value.exists) {
    alert("Template folder is not found.");
    return null;
  }

  var templates = buildTemplateMap(monthRows);
  if (!templates) {
    return null;
  }

  return {
    fromYear: fromYear,
    toYear: toYear,
    outputFormula: outputFormula,
    templates: templates
  };
}

// 1 dòng chọn mốc năm
function addYearRow(parent, label, defaultYear) {
  var row = parent.add("group");
  row.orientation = "row";
  row.alignChildren = ["left", "center"];
  row.spacing = 10;

  var labelText = row.add("statictext", undefined, label);
  labelText.preferredSize.width = 80;

  row.yearField = row.add("edittext", undefined, String(defaultYear));
  row.yearField.preferredSize.width = 70;

  return row;
}

// 1 dòng template: nhãn tháng + dropdown chọn file PSD
function addMonthTemplateRow(parent, month, templateFiles) {
  var row = parent.add("group");
  row.orientation = "row";
  row.alignChildren = ["left", "center"];
  row.spacing = 10;

  row.month = month;

  var labelText = row.add("statictext", undefined, "Tháng " + month);
  labelText.preferredSize.width = 80;

  row.templateDropdown = row.add("dropdownlist", undefined, []);
  row.templateDropdown.preferredSize.width = 320;
  row.templateFiles = [];

  populateMonthRowTemplates(row, templateFiles || []);
  return row;
}

function populateMonthRowsTemplateFiles(monthRows, templateFiles) {
  for (var i = 0; i < monthRows.length; i++) {
    populateMonthRowTemplates(monthRows[i], templateFiles);
  }
}

function populateMonthRowTemplates(row, templateFiles) {
  var previousTemplateName = getSelectedTemplateName(row);
  var dropdown = row.templateDropdown;

  while (dropdown.items.length > 0) {
    dropdown.remove(0);
  }

  row.templateFiles = templateFiles || [];

  if (!templateFiles || templateFiles.length === 0) {
    dropdown.add("item", "Select template folder first");
    dropdown.selection = 0;
    dropdown.enabled = false;
    return;
  }

  dropdown.add("item", "— Bỏ qua tháng này —");
  for (var i = 0; i < templateFiles.length; i++) {
    dropdown.add("item", decodeURI(templateFiles[i].name));
  }
  dropdown.enabled = true;

  // Ưu tiên: lựa chọn cũ → dò theo số tháng trong tên file
  var selectedIndex = 0;
  if (previousTemplateName) {
    selectedIndex = findTemplateIndexByName(templateFiles, previousTemplateName) + 1;
  }
  if (selectedIndex === 0) {
    selectedIndex = findTemplateIndexByMonth(templateFiles, row.month) + 1;
  }

  dropdown.selection = selectedIndex;
}

function getSelectedTemplateName(row) {
  if (!row.templateDropdown.selection || row.templateDropdown.selection.index === 0) {
    return null;
  }
  return row.templateDropdown.selection.text;
}

function getSelectedTemplateFile(row) {
  if (!row.templateDropdown.selection || row.templateDropdown.selection.index === 0) {
    return null;
  }
  var index = row.templateDropdown.selection.index - 1;
  if (!row.templateFiles || index < 0 || index >= row.templateFiles.length) {
    return null;
  }
  return row.templateFiles[index];
}

function findTemplateIndexByName(templateFiles, templateName) {
  if (!templateFiles || !templateName) {
    return -1;
  }

  var normalizedTemplateName = normalizeTemplateName(templateName);
  for (var i = 0; i < templateFiles.length; i++) {
    if (normalizeTemplateName(templateFiles[i].name) === normalizedTemplateName) {
      return i;
    }
  }
  return -1;
}

// Dò template theo số ở cuối tên file (bỏ phần mở rộng): "1", "thang 01", "AGE_12" → tháng tương ứng
function findTemplateIndexByMonth(templateFiles, month) {
  if (!templateFiles || !month) {
    return -1;
  }

  for (var i = 0; i < templateFiles.length; i++) {
    var trailingNumber = normalizeTemplateName(templateFiles[i].name).match(/(\d+)\s*$/);
    if (trailingNumber && parseInt(trailingNumber[1], 10) === month) {
      return i;
    }
  }
  return -1;
}

function normalizeTemplateName(name) {
  name = decodeURI(String(name));
  name = trimString(name).toLowerCase();
  var dotIndex = name.lastIndexOf(".");
  if (dotIndex > 0) {
    return name.substring(0, dotIndex);
  }
  return name;
}

// Map { tháng: file PSD }. Tháng để trống sẽ bị bỏ qua khi chạy.
function buildTemplateMap(monthRows) {
  var templates = {};
  var selectedCount = 0;
  for (var i = 0; i < monthRows.length; i++) {
    var row = monthRows[i];
    var templateFile = getSelectedTemplateFile(row);

    // Để trống = bỏ qua tháng đó
    if (!templateFile) {
      continue;
    }

    if (!isPsdFile(templateFile)) {
      alert("Template của tháng " + row.month + " phải là file .psd.");
      return null;
    }

    templates[row.month] = templateFile;
    selectedCount++;
  }

  if (selectedCount === 0) {
    alert("Vui lòng chọn template cho ít nhất 1 tháng.");
    return null;
  }
  return templates;
}

function getDefaultTemplateFolder() {
  var candidateFolders = [
    new Folder(baseFolder.fsName + "/psd"),
    new Folder(baseFolder.fsName + "/PTS"),
    new Folder(baseFolder.fsName)
  ];

  for (var i = 0; i < candidateFolders.length; i++) {
    if (!candidateFolders[i].exists) {
      continue;
    }
    if (loadTemplateFiles(candidateFolders[i]).length > 0) {
      return candidateFolders[i];
    }
  }

  for (var j = 0; j < candidateFolders.length; j++) {
    if (candidateFolders[j].exists) {
      return candidateFolders[j];
    }
  }

  return candidateFolders[0];
}

function addPathPickerRow(parent, label, kind) {
  var row = parent.add("group");
  row.orientation = "row";
  row.alignChildren = ["left", "center"];
  row.spacing = 10;

  row.add("statictext", undefined, label);

  var pathField = row.add("edittext", undefined, "");
  pathField.preferredSize.width = 300;
  pathField.enabled = false;

  var browseButton = row.add("button", undefined, "Browse...");
  row.pathField = pathField;
  row.browseButton = browseButton;
  row.value = null;

  browseButton.onClick = function () {
    if (kind === "folder") {
      var folder = Folder.selectDialog("Select " + label);
      if (!folder) {
        return;
      }
      row.value = folder;
      pathField.text = folder.fsName;
      return;
    }

    var file = File.openDialog("Select " + label);
    if (!file) {
      return;
    }
    row.value = file;
    pathField.text = file.fsName;
  };

  return row;
}

function parseYear(text, fallback) {
  var normalized = trimString(text).replace(/\s+/g, "");
  if (!/^\d{4}$/.test(normalized)) {
    return fallback;
  }
  return parseInt(normalized, 10);
}

function pad2(value) {
  value = parseInt(value, 10);
  return (value < 10 ? "0" : "") + value;
}

function trimString(value) {
  return String(value).replace(/^\s+|\s+$/g, "");
}

function isPsdFile(fileObj) {
  return !!fileObj && /\.psd$/i.test(fileObj.name);
}

function loadTemplateFiles(folderObj) {
  var files = folderObj.getFiles(/\.(psd)$/i);
  sortFilesByName(files);
  return files;
}

// Sắp xếp theo số trong tên file khi có (1, 2, ... 12), còn lại theo alphabet
function sortFilesByName(files) {
  files.sort(function (a, b) {
    var an = decodeURI(a.name).toLowerCase();
    var bn = decodeURI(b.name).toLowerCase();
    var am = an.match(/(\d+)/);
    var bm = bn.match(/(\d+)/);
    if (am && bm) {
      var av = parseInt(am[1], 10);
      var bv = parseInt(bm[1], 10);
      if (av !== bv) {
        return av < bv ? -1 : 1;
      }
    }
    if (an < bn) {
      return -1;
    }
    if (an > bn) {
      return 1;
    }
    return 0;
  });
}

// Mở template của 1 tháng, xuất lần lượt mọi năm trong khoảng rồi đóng. Trả về số ảnh đã xuất.
function processMonth(month, template, selection) {
  open(template);
  var doc = app.activeDocument;

  // Layer "month" cố định trong suốt vòng lặp năm — chỉ set 1 lần
  var monthLayers = findAllLayersByName(doc, "month");
  for (var ml = 0; ml < monthLayers.length; ml++) {
    changeLayerContent(monthLayers[ml], MONTH_NAMES_EN[month - 1]);
  }

  var yearLayers = findAllLayersByName(doc, "year");

  // Layer "quote" dạng "37 years of mostly sunshine": giữ nguyên chữ, chỉ thay số đầu tiên
  // bằng tuổi. Nội dung gốc phải đọc trước vòng lặp vì mỗi năm sẽ ghi đè lên layer.
  var quoteLayers = findAllLayersByName(doc, "quote");
  var quoteTemplates = [];
  for (var ql = 0; ql < quoteLayers.length; ql++) {
    quoteTemplates.push(String(quoteLayers[ql].textItem.contents));
  }

  var exported = 0;

  for (var year = selection.fromYear; year <= selection.toYear; year++) {
    for (var yl = 0; yl < yearLayers.length; yl++) {
      changeLayerContent(yearLayers[yl], String(year));
    }

    var age = CURRENT_YEAR - year;
    for (var qi = 0; qi < quoteLayers.length; qi++) {
      changeLayerContent(quoteLayers[qi], applyAgeToQuote(quoteTemplates[qi], age));
    }

    var outputFileName = buildOutputFileName(
      applyOutputNameFormula(selection.outputFormula, { month: month, year: year })
    );
    doc.exportDocument(
      new File(outputFolder.fsName + "/" + outputFileName),
      ExportType.SAVEFORWEB,
      exportOptions
    );
    exported++;
  }

  doc.close(SaveOptions.DONOTSAVECHANGES);
  return exported;
}

// Focus text layer → enter text edit mode → paste new content (mirrors manual double-click + paste)
function changeLayerContent(textLayer, content) {
  if (!textLayer) {
    return;
  }

  // Step 1: focus layer (equivalent to clicking the layer in Layers panel)
  app.activeDocument.activeLayer = textLayer;

  // Step 2: enter text edit mode (equivalent to double-clicking the layer)
  var selectDesc = new ActionDescriptor();
  var selectRef = new ActionReference();
  selectRef.putEnumerated(charIDToTypeID("TxLr"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
  selectDesc.putReference(charIDToTypeID("null"), selectRef);
  executeAction(charIDToTypeID("slct"), selectDesc, DialogModes.NO);

  // Step 3: paste new content — replaces all text, preserves layer formatting
  textLayer.textItem.contents = trimString(String(content));
}

// Thay token trong công thức bằng giá trị của tháng đang xử lý.
// Không phân biệt hoa thường; ký tự còn lại trong công thức giữ nguyên.
function applyOutputNameFormula(formula, period) {
  var result = String(formula)
    .replace(/\[month\]/gi, MONTH_NAMES_EN[period.month - 1])
    .replace(/\[year\]/gi, String(period.year))
    .replace(/\[mm\]/gi, pad2(period.month))
    .replace(/\[m\]/gi, String(period.month))
    .replace(/\[yy\]/gi, pad2(period.year % 100));

  if (trimString(result).length === 0) {
    return pad2(period.month) + "-" + period.year;
  }
  return result;
}

// Thay số đầu tiên trong câu quote bằng tuổi; không có số thì ghép tuổi vào đầu câu.
function applyAgeToQuote(quoteText, age) {
  quoteText = String(quoteText);
  if (/\d+/.test(quoteText)) {
    return quoteText.replace(/\d+/, String(age));
  }
  return String(age) + " " + quoteText;
}

function sanitizeFileName(name) {
  return name.replace(/[\\\/:\*\?"<>\|]/g, "_");
}

function buildOutputFileName(outputName) {
  var fileName = sanitizeFileName(trimString(outputName)).replace(/[\. ]+$/g, "");
  if (fileName.length === 0) {
    fileName = "output";
  }
  if (!/\.png$/i.test(fileName)) {
    fileName += ".png";
  }
  return fileName;
}

function findLayers(searchFolder, recursion, userData, items) {
  items = items || [];
  var folderItem;
  for (var i = 0; i < searchFolder.layers.length; i++) {
    folderItem = searchFolder.layers[i];
    if (propertiesMatch(folderItem, userData)) {
      items.push(folderItem);
    }
    if (recursion === true && folderItem.typename === "LayerSet") {
      findLayers(folderItem, recursion, userData, items);
    }
  }
  return items;
}

function propertiesMatch(projectItem, userData) {
  if (typeof userData === "undefined") return true;
  for (var propertyName in userData) {
    if (!userData.hasOwnProperty(propertyName)) continue;
    if (!projectItem.hasOwnProperty(propertyName)) return false;
    if (projectItem[propertyName].toString() !== userData[propertyName].toString()) {
      return false;
    }
  }
  return true;
}

function findAllLayersByName(doc, name) {
  return findLayers(doc, true, { name: name });
}
