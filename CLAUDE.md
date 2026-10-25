# 黒猫亭の作業の決まり

何を良しとするか（開発方針）は [`docs/principles.md`](docs/principles.md) にまとめてある。

- 振る舞いを変えたら、同じ変更で `docs/spec.md` も直す（`docs/spec.md` の冒頭を参照）。
- 仕様のテスト（`node tools/spec-test.mjs`）と画面のテスト（`node --test tools/browser-test.mjs`）と lint（`node tools/lint.mjs`）を通してから push する。
- **大きな変更（戦闘・成長・経済・ダンジョン・一行の動きなど、釣り合いに効くもの）をしたら、`node tools/measure.mjs --seeds 16 --days 1400` で支援なしと支援ありの両方を測り、結果（どちらの店が何回踏破したか、踏破日、レベル）を PR に書く。** 測り方は README の「釣り合いを測る」を参照。
- **シミュレーションの結果が変わる変更では、`node tools/fingerprint.mjs --update` で釣り合いの指紋（`tools/fingerprint.json`）を書き直し、同じ変更に入れる。** 結果を変えないつもりの変更（表示だけの直しなど）では書き直さない。CI は `node tools/fingerprint.mjs --check` で比べ、違えば落ちる。指紋を書き直した PR では、CI が変更前と並べて measure で測った表をジョブの要約に残すので、それ（または手で測った measure の結果）を PR に書く。詳しくは README の「釣り合いの指紋」。

## 決まりと、それを守らせる仕組み

| 決まり | 守らせるもの |
|---|---|
| `docs/spec.md` の決まりが、コードで成り立つ | テスト：`tools/spec-test.mjs`（CI） |
| 画面の決まり（折り返し、はみ出し、押す所の大きさなど）が成り立つ | テスト：`tools/browser-test.mjs`（CI） |
| index.html の script に、使っていない名前と宣言していない名前を残さない | lint：`tools/lint.mjs`（ESLint、CI） |
| テストと measure からだけ使う名前は、index.html の `/* exported … */` に並べる | lint：`tools/lint.mjs`（CI） |
| 冒険者の status を文字列と直に比べない（`isActive`・`isIdle` などを通す） | lint：`tools/lint.mjs`（CI） |
| テストからエンジンの名前を使うのに、一覧は書かない | 仕組み：`tools/engine.mjs` がトップレベルの宣言を名前で引く |
| 古いセーブを壊さない | テスト：spec-test が `tools/old-saves/` の版ごとの見本を今の migrate にかける（CI）。SAVE_V を上げる PR では、上げる前の版の見本を足す（README「仕様のテスト」） |
| 振る舞いを変えたら、同じ変更で `docs/spec.md` を直す | 人のレビュー |
| 釣り合いに効く変更は、支援なしと支援ありの両方を測って PR に書く | 人のレビュー。指紋を書き直した PR では、CI が変更前と並べて measure で測り、ジョブの要約に残す |
| シミュレーションの結果が変わったら、同じ変更で釣り合いの指紋を書き直す | テスト：`tools/fingerprint.mjs --check`（CI） |
| 死因を、ひとつの魔物に集めすぎない（帯ごとに、いちばん多い魔物が60%以下。目安は4割ほど） | テスト：`tools/fingerprint.mjs` の死因の偏りの確かめ（CI） |
| 上のテストと lint がすべて通ってから main に入れる | CI：まとめの `test` ジョブ |
