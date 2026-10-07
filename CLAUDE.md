# 黒猫亭の作業の決まり

- 振る舞いを変えたら、同じ変更で `docs/spec.md` も直す（`docs/spec.md` の冒頭を参照）。
- 仕様のテスト（`node tools/spec-test.mjs`）と画面のテスト（`node --test tools/browser-test.mjs`）を通してから push する。
- **大きな変更（戦闘・成長・経済・ダンジョン・一行の動きなど、釣り合いに効くもの）をしたら、`node tools/measure.mjs --seeds 16 --days 1400` で支援なしと支援ありの両方を測り、結果（どちらの店が何回踏破したか、踏破日、レベル）を PR に書く。** 測り方は README の「釣り合いを測る」を参照。
