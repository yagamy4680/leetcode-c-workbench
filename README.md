# LeetCode C Workbench

在同一台 Mac 上執行的 C 解題工作台：本機 editor／CLI 和網頁共用解法與測試。預設啟用 ASan／UBSan，保留完整編譯訊息、`printf` output 和 sanitizer log；通過本機測試後，再手動提交到 LeetCode。

## Mac 安裝

需要 Node.js 20.19 以上、Python 3.9 以上、Git，以及支援 ASan／UBSan 的 C compiler。Node.js 22／24 LTS 均可使用。

```bash
xcode-select --install
git clone https://github.com/yagamy4680/leetcode-c-workbench.git
cd leetcode-c-workbench
npm ci
cp .env.example .env
# 編輯 .env：設定 repo 外的 WB_DATA_DIR，例如 ~/leetcode-workspace。
npm run setup
./wb.sh doctor
npm start
```

瀏覽 `http://127.0.0.1:3089`。Setup 會為空白的 Basic Auth 欄位產生本機帳號設定，帳密位於 **`.env`**，不會印出或提交 Git。已有的題目及解法不會被 setup 覆蓋。修改 `.env` 後重新啟動服務；CLI 每次執行都讀取它。

初始題目為 **1480、783、589**，`solution-master.c` 是 TODO 框架，測試失敗代表尚未實作。附件中的 Minimum Distance Between BST Nodes URL 對應 **783**；等價的 530 使用不同函式名稱。

服務啟動時會顯示實際 workspace 與 SQLite 路徑，並在開始監聽前檢查四個必要資料表。空資料庫會自動初始化及補入缺少的範例題目；已有解法會保留。非空資料庫若缺少資料表，會停止並提示檢查路徑及執行 `npm run setup`，不會自動重設資料。

若出現 `P2021: main.Problem does not exist`，先停止服務，執行 `npm run setup` 後重新啟動，確認兩者輸出的 SQLite 路徑相同。預設檔案是 `$WB_DATA_DIR/workbench.db`。需要自訂時可設定 SQLite `DATABASE_URL`；setup 和 runtime 使用同一個正規化的絕對路徑。相對 `DATABASE_URL` 以 `prisma/` 為基準，相對 `WB_DATA_DIR` 以 application checkout 為基準，不受啟動 cwd 影響。

## 本機操作

題目位於 `$WB_DATA_DIR/problems/<id>/`。使用任何 editor 編輯 `solution-master.c`，或從網頁編輯。

```bash
./run-test.sh 1480
./run-test.sh 589 non-recursive
./run-test.sh 589 non-recursive --case example1
./run-test.sh 589 non-recursive --watch
./run-test.sh 1480 --mode perf
./wb.sh doctor --refresh
./wb.sh snapshot 1480 master
```

`master`、`non-recursive` 等名稱代表解法檔案，並非 Git branches。可由網頁 New variant 複製解法，或在題目目錄複製為 `solution-<name>.c`。

也可使用 `make run PROBLEM=589 SOLUTION=non-recursive MODE=debug`；`make help` 列出其他入口。

CLI 測試不需要 Node.js 服務或 SQLite。CLI 完成的 run 會在網頁服務執行／重啟後匯入，run ID 確保不重複記錄。

Exit codes：`0` 全部通過、`1` 編譯或測試失敗、`2` 設定／framework 錯誤、`130` 使用者中斷。

## 測試與除錯

Debug 預設使用 GNU11、`-O1 -g`、warnings、ASan／UBSan 和 frame pointers；Performance 使用 `-O2` 並關閉 sanitizers。Compiler 由 `CC` 選擇，未設定時優先找 `clang`，再找 `cc`。`CC` 是 executable 路徑，額外 flags 不要放在其中。

`doctor` 會實際編譯和執行 probe，驗證 sanitizer 能力。LeakSanitizer 必須以已知 leak 的程式確認可用，不能把「未檢查」當成通過。如果 Mac 預設 Apple Clang 的 leak probe 不可用，可安裝上游 LLVM，將其 `clang` 絕對路徑填入 `CC`，重新執行 `doctor --refresh`。ASan／UBSan 的支援與 leak detection 分開顯示。

每個 testcase 是獨立 C process，含 timeout、process-group cleanup 和 log 上限；某個案例 crash 不會擋住下一個案例。測試器一次編譯，多案例共用 binary。程式、headers、helpers、compiler 或 flags 變更才重建；只變更 tests 不重新編譯。

```json
[
  {
    "id": "example1",
    "input": { "nums": [1, 2, 3, 4] },
    "expected": [1, 3, 6, 10],
    "timeoutMs": 2000,
    "compare": "exact"
  }
]
```

比對支援 `exact`、`unordered`（僅最外層 array，保留重複元素）與 `float`（可設定 tolerance）。`input` 必須符合該題 driver 所需欄位。

Actual answer 寫入獨立 JSON 檔；stdout／stderr 都留作 log，因此可以直接使用 `printf()` 除錯。預設設定 unbuffered output。結果區分編譯失敗、wrong answer、memory error、memory leak、undefined behavior、runtime error、driver error、timeout 和 output limit。

每次 run 保留 source 副本與 hash。網頁的 Tested source 可查看實際測試版本，錯誤行號按鈕在 editor 版本相符時可跳到該行。也可以直接使用 LLDB：

```bash
# 從 runs/<run-id>/result.json 取得 buildHash，case 路徑也是固定的。
ASAN_OPTIONS=detect_leaks=0 lldb -- \
  "$WB_DATA_DIR/builds/<buildHash>/program" \
  "$WB_DATA_DIR/runs/<run-id>/cases/<case-id>/input.json" \
  "$WB_DATA_DIR/runs/<run-id>/cases/<case-id>/debug-result.json"
```

這裡的 `WB_DATA_DIR` 指實際 workspace 路徑；`.env` 不會自動成為 terminal 的 shell variables。Debugger 下另行停用 leak probe，不修改原本的測試紀錄。

## Framework 與 ownership

每題至少包含 `manifest.json`、`description.md`、`solution.h`、`main.c`、`solution-master.c`、`tests.json`。

Python 負責 orchestration；薄層 C driver 負責 JSON 轉換、呼叫 solution、序列化與清理。共用 helpers 支援 integer／integer array、binary tree、N-ary tree 與 linked list。`struct Node` 定義依題目選用，不是跨所有題目的全域型別。其他結構由新增題目的 framework／helper 擴充。

解法檔案保留 LeetCode 的 signature，不加入 `main()`、JSON parsing 或 workbench helper 依賴。Solution 所需標準 headers／struct 定義由本機編譯框架提供；提交時只複製解法。若題目需要額外自訂算法 helpers，應放在提交用的 solution 檔案內。

Ownership 由每題 driver 明確定義：1480 接受新配置的結果或原輸入 array，避免重複 free；783／589 的輸入節點屬於 driver；589 的新配置回傳 array 由 driver free。List／tree allocation registry 會清理 driver 的原輸入節點，即使連結被改動。會在 solution 中釋放輸入或回傳新節點的題目，需要對應的清理契約與 driver。

## Submission

網頁 Prepare submission snapshot 先固定 Git commit，再顯示可複製的程式碼。你手動提交到 LeetCode 後，記錄 pending／success／fail 和 memo。之後編輯 solution 不影響先前紀錄；重新查看 submission 時，程式碼由原 Git commit 取出。

Local test 關聯要求 **solution、framework、helpers、metadata 和 tests 都相同**。相同程式碼但測試資料已修改，會顯示 untested。SQLite 只存 metadata、run 摘要、submission 結果與 commit references；不保存可編輯的程式碼 blob。

`./wb.sh snapshot` 可在網頁停止時建立本機 Git snapshot，輸出包含程式碼與 commit 的 JSON。CLI snapshot 是 Git 檔案歸檔；透過網頁或 REST API 建立的 snapshot 另有 SQLite submission 紀錄。

## 資料與公開 repository

```text
Application checkout: server/, runner/, runtime/, examples/, web/
External workspace:  problems/, runs/, builds/, snapshots/, workbench.db
```

個人解法和認證設定不進 application repository。Snapshot Git repo 預設沒有 remote。更新系統程式不會重建既有個人題目。備份時請保存整個 workspace，包含 SQLite 及 snapshots Git repo；服務停止後備份較簡單。

這是單一使用者、執行自己信任的 C 程式的工作台；native runner 使用目前的 macOS 使用者權限。全部網頁與 API 都要求 Basic Auth；公網存取使用 HTTPS reverse proxy。Node.js 預設僅監聽 loopback。

## REST API 與部署

完整介面及匯入格式見 [docs/API.md](docs/API.md)。Mac reverse proxy 範例見 [deploy/Caddyfile.example](deploy/Caddyfile.example)。設定 DNS、Caddy 與 Mac 開機服務後，即可使用 `https://leetcode.myab.cc`；這個 repo 不會自動改動你現有的 Caddy 設定。

## 開發與驗證

```bash
npm ci
npm test
npm audit
npm run build:css
```

測試會在 temporary workspace 執行，不改動個人資料。涵蓋三題完整資料轉換、variants、compile cache、固定 run source、stdout 分離、ownership、compiler errors、sanitizer errors、timeout、Git snapshot、Basic Auth、原始檔衝突、REST import、web streaming、submission 和離線 CLI 匯入。

Leak 測試只有 host probe 可用時才執行；不支援或受環境限制時明確 skip。此版本已做 Linux native runner／API 整合驗證，Mac 原生 compiler、LLDB 與瀏覽器視覺排版仍需要在你的 Mac 實際驗收。本機通過不代表涵蓋 LeetCode 所有 hidden tests。
