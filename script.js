/* =========================================================
   農家民宿 村の宿 予約リクエストフォーム
   ---------------------------------------------------------
   ▼▼ 設定：ここだけ書き換えます ▼▼
   GASを「ウェブアプリ」としてデプロイしたときに表示される
   https://script.google.com/macros/s/........./exec
   というURLを、下の '' の中に貼り付けてください。
   （再デプロイでURLが変わった場合も、ここを貼り替えるだけです）
   ========================================================= */
var GAS_URL = 'https://script.google.com/macros/s/AKfycbw6-cZRCzsLRkUfqGOk-YJCXYb3oT1B7kH7M_AeSGUbujx4Q4ZsXWXiKejh6aHBMQLX/exec';

/* ▼ 定員（要件：一棟貸し 定員5名） */
var CAPACITY = 5;

/* ▼ 何日後から予約を受け付けるか
   2 なら「2日後の日付から選択可能」＝今日と明日は選べません。
   変更するときは gas/コード.gs の「最短受付日数」も同じ数字にしてください */
var MIN_DAYS_AHEAD = 2;


(function () {
  'use strict';

  var form        = document.getElementById('reserveForm');
  var formSection = document.getElementById('formSection');
  var thanks      = document.getElementById('thanks');
  var submitBtn   = document.getElementById('submitBtn');
  var errorBox    = document.getElementById('errorBox');
  var capacityWarn= document.getElementById('capacityWarn');
  var adultsEl    = document.getElementById('adults');
  var childrenEl  = document.getElementById('children');
  var date1El     = document.getElementById('date1');
  var date2El     = document.getElementById('date2');

  var sending = false;   // 二度押し防止のフラグ

  /* -------------------------------------------------------
     1. 受付できる最短の日付（今日の MIN_DAYS_AHEAD 日後）より
        前を選べないようにする
     ------------------------------------------------------- */
  function dateString(d) {
    var m = ('0' + (d.getMonth() + 1)).slice(-2);
    var day = ('0' + d.getDate()).slice(-2);
    return d.getFullYear() + '-' + m + '-' + day;
  }

  var minDate = '';        // 受付できる最短の日（yyyy-mm-dd）
  var minDateLabel = '';   // 画面表示用（例：8月10日）

  function 最短日を設定(ymd) {
    minDate = ymd;
    var 部品 = ymd.split('-');
    minDateLabel = Number(部品[1]) + '月' + Number(部品[2]) + '日';

    date1El.min = minDate;
    date2El.min = minDate;

    // 日付欄の下の「◯月◯日以降」の表示を更新する
    Array.prototype.forEach.call(document.querySelectorAll('.js-min-date'), function (el) {
      el.textContent = minDateLabel;
    });
  }

  // まず端末の日付から計算しておく（あとでGASの値（日本時間）で上書きします）
  var 最短日 = new Date();
  最短日.setDate(最短日.getDate() + MIN_DAYS_AHEAD);
  最短日を設定(dateString(最短日));

  /* =======================================================
     空き状況カレンダー
     GASに「予約できない日の一覧」だけを問い合わせます。
     予定のタイトルなどは一切受け取りません。
     読み込めなかった場合はカレンダーを隠し、送信は通します
     （最終的な空き確認はGAS側で行います）
     ======================================================= */

  var calendarBox = document.getElementById('calendarBox');
  var calTitle    = document.getElementById('calTitle');
  var calGrid     = document.getElementById('calGrid');
  var calPrev     = document.getElementById('calPrev');
  var calNext     = document.getElementById('calNext');
  var calStatus   = document.getElementById('calStatus');

  var 予約不可 = {};          // 例：{ '2026-08-20': true }
  var 空き状況あり = false;    // カレンダーを読み込めたか

  function 月初(d) {
    var x = new Date(d.getFullYear(), d.getMonth(), 1);
    x.setHours(0, 0, 0, 0);
    return x;
  }

  var 表示月 = 月初(new Date());
  var 表示下限 = 月初(new Date());
  var 表示上限 = 月初(new Date());
  表示上限.setMonth(表示上限.getMonth() + 13);   // 13か月先まで見られるようにする

  /** カレンダーの月を描き直す */
  function カレンダー描画() {
    var 年 = 表示月.getFullYear();
    var 月 = 表示月.getMonth();

    calTitle.textContent = 年 + '年' + (月 + 1) + '月';

    var 曜日 = new Date(年, 月, 1).getDay();          // その月の1日の曜日
    var 日数 = new Date(年, 月 + 1, 0).getDate();     // その月の日数
    var html = '';

    // 1日の前に空白のマスを入れて曜日を合わせる
    for (var i = 0; i < 曜日; i++) {
      html += '<div class="cal-day cal-empty"></div>';
    }

    for (var d = 1; d <= 日数; d++) {
      var ymd = 年 + '-' + ('0' + (月 + 1)).slice(-2) + '-' + ('0' + d).slice(-2);
      var 区分, 記号;

      if (ymd < minDate) {
        区分 = 'cal-off'; 記号 = '−';        // 受付前（今日・明日など）
      } else if (予約不可[ymd]) {
        区分 = 'cal-ng';  記号 = '×';        // 終日予定あり＝予約できない
      } else {
        区分 = 'cal-ok';  記号 = '○';
      }

      html += '<div class="cal-day ' + 区分 + '">' +
                '<span class="d">' + d + '</span>' +
                '<span class="m">' + 記号 + '</span>' +
              '</div>';
    }

    calGrid.innerHTML = html;
    calPrev.disabled = 表示月 <= 表示下限;
    calNext.disabled = 表示月 >= 表示上限;
  }

  calPrev.addEventListener('click', function () {
    表示月.setMonth(表示月.getMonth() - 1);
    カレンダー描画();
  });
  calNext.addEventListener('click', function () {
    表示月.setMonth(表示月.getMonth() + 1);
    カレンダー描画();
  });

  /** 選んだ日が予約できるかを、日付欄の下に表示する */
  function 判定表示(id) {
    var 欄 = document.getElementById(id);
    var 表示 = document.getElementById(id + 'Judge');
    var 値 = 欄.value;

    表示.classList.remove('ok', 'ng');

    // 未入力・カレンダー未取得・受付前の日は、ここでは何も出さない
    if (!値 || !空き状況あり || 値 < minDate) {
      表示.hidden = true;
      return;
    }

    if (予約不可[値]) {
      表示.textContent = '× この日はご予約いただけません。別の日をお選びください。';
      表示.classList.add('ng');
    } else {
      表示.textContent = '○ この日はご予約いただけます。';
      表示.classList.add('ok');
    }
    表示.hidden = false;
  }

  date1El.addEventListener('change', function () { 判定表示('date1'); });
  date2El.addEventListener('change', function () { 判定表示('date2'); });

  /** 読み込めなかったとき（カレンダー未作成・通信不良など） */
  function 空き状況なしで続行() {
    空き状況あり = false;
    calendarBox.hidden = true;
    calStatus.textContent =
      '空き状況を読み込めませんでした。ご希望日をご入力のうえ送信いただければ、' +
      '空き状況を確認してご連絡いたします。';
    calStatus.classList.add('is-warn');
  }

  /** GASから予約できない日の一覧を取得する */
  function 空き状況を読み込む() {
    if (!GAS_URL || GAS_URL.indexOf('https://') !== 0) {
      空き状況なしで続行();
      return;
    }

    fetch(GAS_URL + '?action=blocked')
      .then(function (res) { return res.json(); })
      .then(function (result) {
        if (!result || !result.ok) throw new Error(result && result.error);

        // GASが日本時間で計算した最短受付日に合わせる
        if (result.minDate) 最短日を設定(result.minDate);

        (result.dates || []).forEach(function (d) { 予約不可[d] = true; });

        空き状況あり = true;
        calendarBox.hidden = false;
        calStatus.textContent = '×の日はすでにご予約が入っております。';
        calStatus.classList.remove('is-warn');

        カレンダー描画();
        判定表示('date1');
        判定表示('date2');
      })
      .catch(function () {
        空き状況なしで続行();
      });
  }

  /* -------------------------------------------------------
     2. 合計人数が定員を超えたら警告を出す
     ------------------------------------------------------- */
  function totalGuests() {
    return (parseInt(adultsEl.value, 10) || 0) + (parseInt(childrenEl.value, 10) || 0);
  }
  function updateCapacityWarn() {
    capacityWarn.hidden = totalGuests() <= CAPACITY;
  }
  adultsEl.addEventListener('change', updateCapacityWarn);
  childrenEl.addEventListener('change', updateCapacityWarn);

  /* -------------------------------------------------------
     3. 送信前チェック
     戻り値：エラーメッセージの配列（空なら問題なし）
     ------------------------------------------------------- */
  function validate(data) {
    var errors = [];

    // 前回のエラー表示をいったん消す
    Array.prototype.forEach.call(form.querySelectorAll('.is-error'), function (el) {
      el.classList.remove('is-error');
    });

    function ng(id, msg) {
      var el = document.getElementById(id);
      if (el && el.closest('.field')) el.closest('.field').classList.add('is-error');
      errors.push(msg);
    }

    if (!data.name)  ng('name',  'お名前をご入力ください。');
    if (!data.email) {
      ng('email', 'メールアドレスをご入力ください。');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      ng('email', 'メールアドレスの形式をご確認ください。');
    }
    if (!data.tel)    ng('tel',    '電話番号をご入力ください。');
    if (!data.date1) {
      ng('date1', '宿泊希望日（第1希望）をご入力ください。');
    } else if (data.date1 < minDate) {
      ng('date1', '宿泊希望日（第1希望）は' + minDateLabel +
                  '以降の日付をお選びください。（ご予約は2日前まで承っております）');
    }
    if (data.date2 && data.date2 < minDate) {
      ng('date2', '宿泊希望日（第2希望）は' + minDateLabel +
                  '以降の日付をお選びください。（ご予約は2日前まで承っております）');
    }
    // カレンダーを読み込めているときだけ確認する
    // （読み込めていない場合は送信を通し、GAS側で最終判断します）
    if (空き状況あり) {
      if (data.date1 && 予約不可[data.date1]) {
        ng('date1', '宿泊希望日（第1希望）は、すでにご予約が入っております。別の日をお選びください。');
      }
      if (data.date2 && 予約不可[data.date2]) {
        ng('date2', '宿泊希望日（第2希望）は、すでにご予約が入っております。別の日をお選びください。');
      }
    }

    if (!data.nights) ng('nights', '泊数をお選びください。');
    if (!data.adults) ng('adults', '大人の人数をお選びください。');

    if (totalGuests() > CAPACITY) {
      ng('children', '定員は' + CAPACITY + '名です。大人とお子様の合計人数をご確認ください。');
    }
    return errors;
  }

  /* -------------------------------------------------------
     4. フォームの内容を1つのオブジェクトにまとめる
     ------------------------------------------------------- */
  function collect() {
    var experiences = Array.prototype.slice
      .call(form.querySelectorAll('input[name="experiences"]:checked'))
      .map(function (el) { return el.value; });

    // form.name はフォーム自身の名前を指してしまうため、
    // 入力欄は form.elements[...] から取り出します
    var f = form.elements;
    function val(key) { return (f[key].value || '').trim(); }

    return {
      name:      val('name'),
      email:     val('email'),
      tel:       val('tel'),
      date1:     f.date1.value,
      date2:     f.date2.value,
      nights:    f.nights.value,
      adults:    f.adults.value,
      children:  f.children.value,
      childAges: val('childAges'),
      experiences: experiences.join('、'),
      source:    f.source.value,
      message:   val('message'),
      company:   val('company')   // honeypot（人は空のまま）
    };
  }

  /* -------------------------------------------------------
     5. 送信完了画面へ切り替える
     ------------------------------------------------------- */
  function showThanks() {
    formSection.hidden = true;
    thanks.hidden = false;
    window.scrollTo(0, 0);
  }

  /** 送信ボタンを押せる状態に戻す（エラーで再入力してもらうとき） */
  function 再入力できる状態に戻す() {
    sending = false;
    submitBtn.disabled = false;
    submitBtn.textContent = 'リクエストを送信する';
  }

  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.hidden = false;
    errorBox.scrollIntoView({ block: 'center' });
  }

  /* -------------------------------------------------------
     6. 送信処理
     ------------------------------------------------------- */
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (sending) return;              // 二度押し防止

    errorBox.hidden = true;
    var data = collect();

    // honeypotに入力があればボットとみなし、送信せず完了画面だけ出す
    if (data.company) { showThanks(); return; }

    var errors = validate(data);
    if (errors.length) {
      showError(errors.join('\n'));
      return;
    }

    if (!GAS_URL || GAS_URL.indexOf('https://') !== 0) {
      showError('送信先が設定されていません。恐れ入りますが、お電話またはInstagramのDMでご連絡ください。');
      return;
    }

    sending = true;
    submitBtn.disabled = true;
    submitBtn.textContent = '送信中…';

    // Content-Type を text/plain にすると事前確認（プリフライト）が発生せず、
    // GitHub Pages から GAS へそのまま送信できます。中身はJSONです。
    fetch(GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(data)
    })
      .then(function (res) { return res.json(); })
      .then(function (result) {
        if (result && result.ok) {
          showThanks();
          return;
        }
        // GASがお客様向けの案内文を返した場合は、それをそのまま表示して
        // 入力し直せる状態に戻す（例：ご希望日が直前のとき）
        if (result && result.message) {
          再入力できる状態に戻す();
          showError(result.message);
          return;
        }
        throw new Error((result && result.error) || 'unknown');
      })
      .catch(function () {
        再入力できる状態に戻す();
        showError(
          '送信に失敗しました。通信環境をご確認のうえ、もう一度お試しください。\n' +
          '繰り返し失敗する場合は、お手数ですがInstagramのDMからご連絡ください。'
        );
      });
  });

  /* -------------------------------------------------------
     7. ページを開いたら空き状況を読み込む
     ------------------------------------------------------- */
  空き状況を読み込む();

})();
