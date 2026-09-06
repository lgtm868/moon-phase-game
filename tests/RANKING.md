# ランキングのテスト

ランキングのバックエンドは Sites で別管理しています。GitHub のゲーム用リポジトリにはバックエンドのフォルダを含めません。

## サーバーのルールを検証する

対応するバージョンのバックエンドソースを別の場所にチェックアウト／配置し、`lib/ranking-rules.mjs` があるディレクトリを指定します。PowerShell の例です。

```powershell
$env:RANKING_SERVICE_DIR = 'C:\work\moon-ranking-backend'
node tests/ranking-server-check.cjs
```

未指定時は、従来どおりゲームのルートにある `leaderboard-service` を参照します。採点・入力検証に加えて、バックエンドのピアノ譜面情報とゲームの実際の譜面が一致することを確認します。通信やデータの書き込みは行いません。

## HTTP API を検証する

このテストにはバックエンドソースは不要です。`RANKING_TEST_BASE` に API の URL を指定します。公開環境では書き込みを無効にします。

```powershell
$env:RANKING_TEST_BASE = 'https://moon-games-ranking.abccasfda.chatgpt.site'
$env:RANKING_TEST_WRITES = '0'
node tests/ranking-http-check.cjs
```

ローカルのテスト用データベースでは、`RANKING_TEST_WRITES=1` で同時送信・重複防止・ランキングの分離・送信回数制限も検証できます。架空のプレイヤーと記録を作るため、書き込みテストは localhost のみに制限しています。結果は `output/ranking-tests/http-report.json` に保存します。
