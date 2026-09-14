/* =========================================================
   農家民宿 村の宿・丹波 予約リクエストフォーム
   ---------------------------------------------------------
   ▼▼ 設定：ここだけ書き換えます ▼▼
   GASを「ウェブアプリ」としてデプロイしたときに表示される
   https://script.google.com/macros/s/........./exec
   というURLを、下の '' の中に貼り付けてください。
   （再デプロイでURLが変わった場合も、ここを貼り替えるだけです）
   ========================================================= */
var GAS_URL = 'https://script.google.com/macros/s/AKfycbw6-cZRCzsLRkUfqGOk-YJCXYb3oT1B7kH7M_AeSGUbujx4Q4ZsXWXiKejh6aHBMQLX/exec';

/* ▼ 定員（一棟貸し 定員10名） */
var CAPACITY = 10;

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
  var checkinEl   = document.getElementById('checkin');
  var checkoutEl  = document.getElementById('checkout');
  var date2InEl   = document.getElementById('date2Checkin');
  var date2OutEl  = document.getElementById('date2Checkout');
  var nightsDisp  = document.getElementById('nightsDisplay');

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

  /** 'yyyy-mm-dd' → Dateオブジェクト（時刻は0時） */
  function toDate(ymd) {
    var p = ymd.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  /** 'yyyy-mm-dd' を「9月15日」のような表示にする */
  function 和表示(ymd) {
    var p = ymd.split('-');
    return Number(p[1]) + '月' + Number(p[2]) + '日';
  }

  /** チェックイン日〜チェックアウト日の泊数（日数の差） */
  function 泊数を計算(inYmd, outYmd) {
    return Math.round((toDate(outYmd) - toDate(inYmd)) / 86400000);
  }

  /** 'yyyy-mm-dd' の翌日を返す */
  function 翌日(ymd) {
    var d = toDate(ymd);
    d.setDate(d.getDate() + 1);
    return dateString(d);
  }

  var minDate = '';        // 受付できる最短の日（yyyy-mm-dd）
  var minDateLabel = '';   // 画面表示用（例：8月10日）

  function 最短日を設定(ymd) {
    minDate = ymd;
    minDateLabel = 和表示(ymd);

    checkinEl.min = minDate;
    checkoutEl.min = checkinEl.value ? 翌日(checkinEl.value) : minDate;
    date2InEl.min = minDate;
    date2OutEl.min = date2InEl.value ? 翌日(date2InEl.value) : minDate;

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
     （最終的な空き確認はGAS側で行います）。
     カレンダーの日付をタップすると、
     チェックイン日→チェックアウト日の順に選択できます。
     ======================================================= */

  var calendarBox = document.getElementById('calendarBox');
  var calTitle    = document.getElementById('calTitle');
  var calGrid     = document.getElementById('calGrid');
  var calPrev     = document.getElementById('calPrev');
  var calNext     = document.getElementById('calNext');
  var calStatus   = document.getElementById('calStatus');

  var 予約不可 = {};          // 例：{ '2026-08-20': true }（その日の「夜」が埋まっている）
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

  /**
   * チェックイン日〜チェックアウト日の間の「夜」がすべて空いているか。
   * 泊まる夜は チェックイン日 〜 チェックアウト前日 なので、
   * チェックアウト日そのものの空きは問いません。
   */
  function 範囲が空いている(inYmd, outYmd) {
    var d = toDate(inYmd);
    var out = toDate(outYmd);
    while (d < out) {
      if (予約不可[dateString(d)]) return false;
      d.setDate(d.getDate() + 1);
    }
    return true;
  }

  /** カレンダーの月を描き直す（選択中の範囲の色付けもここで行う） */
  function カレンダー描画() {
    var 年 = 表示月.getFullYear();
    var 月 = 表示月.getMonth();

    calTitle.textContent = 年 + '年' + (月 + 1) + '月';

    var 曜日 = new Date(年, 月, 1).getDay();          // その月の1日の曜日
    var 日数 = new Date(年, 月 + 1, 0).getDate();     // その月の日数
    var html = '';

    var イン  = checkinEl.value;
    var アウト = checkoutEl.value;

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
        区分 = 'cal-ng';  記号 = '×';        // 終日予定あり＝その夜は予約できない
      } else {
        区分 = 'cal-ok';  記号 = '○';
      }

      // 選択中の範囲に色を付ける
      if (イン && ymd === イン)  区分 += ' cal-sel cal-sel-in';
      if (アウト && ymd === アウト) 区分 += ' cal-sel cal-sel-out';
      if (イン && アウト && ymd > イン && ymd < アウト) 区分 += ' cal-range';

      html += '<div class="cal-day ' + 区分 + '" data-ymd="' + ymd + '">' +
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

  /* -------------------------------------------------------
     カレンダーのタップ選択
     1回目のタップ＝チェックイン日、2回目＝チェックアウト日。
     選び直したいときは、もう一度どこかの日をタップすれば
     そこが新しいチェックイン日になります。
     ------------------------------------------------------- */
  calGrid.addEventListener('click', function (ev) {
    var cell = ev.target.closest('.cal-day');
    if (!cell || !cell.getAttribute('data-ymd')) return;

    var ymd = cell.getAttribute('data-ymd');
    if (ymd < minDate) return;                  // 受付前の日は無視

    var イン  = checkinEl.value;
    var アウト = checkoutEl.value;

    if (!イン || (イン && アウト)) {
      // 新しく選び始める（チェックイン日はその夜が空いている日だけ）
      if (予約不可[ymd]) return;
      checkinEl.value = ymd;
      checkoutEl.value = '';
    } else if (ymd <= イン) {
      // チェックイン日より前（または同じ日）をタップ→選び直し
      if (予約不可[ymd]) return;
      checkinEl.value = ymd;
      checkoutEl.value = '';
    } else if (範囲が空いている(イン, ymd)) {
      // チェックアウト日として確定
      checkoutEl.value = ymd;
    } else {
      // 間に×の日がある→そこを新しいチェックイン日として選び直し
      if (予約不可[ymd]) return;
      checkinEl.value = ymd;
      checkoutEl.value = '';
    }

    選択を反映();
  });

  /** 入力欄・泊数表示・カレンダーの色付けをまとめて更新する */
  function 選択を反映() {
    var イン  = checkinEl.value;
    var アウト = checkoutEl.value;

    // チェックイン日が決まったら、チェックアウト欄はその翌日以降しか
    // 選べないようにする（日付ピッカーもその月から開く）
    checkoutEl.min = イン ? 翌日(イン) : minDate;

    if (イン && アウト && アウト > イン) {
      var 泊 = 泊数を計算(イン, アウト);
      nightsDisp.textContent =
        和表示(イン) + ' チェックイン → ' + 和表示(アウト) + ' チェックアウト（' + 泊 + '泊）';
      nightsDisp.hidden = false;
    } else if (イン) {
      nightsDisp.textContent =
        和表示(イン) + ' チェックイン → チェックアウト日をお選びください';
      nightsDisp.hidden = false;
    } else {
      nightsDisp.hidden = true;
    }

    判定表示();
    if (空き状況あり) カレンダー描画();
  }

  /** 選んだ日程に問題があるときだけ、日付欄の下に警告を出す
      （×の日=休業日シート上確実に埋まっている日、のときのみ。
        ○の断定表示はしない。楽天・Airbnb分の反映が手動のため、
        このフォームは「予約できる」とは約束できない） */
  function 判定表示() {
    var インJ  = document.getElementById('checkinJudge');
    var アウトJ = document.getElementById('checkoutJudge');
    var イン  = checkinEl.value;
    var アウト = checkoutEl.value;

    インJ.classList.remove('ok', 'ng');
    アウトJ.classList.remove('ok', 'ng');
    インJ.hidden = true;
    アウトJ.hidden = true;

    if (!空き状況あり) return;   // カレンダー未取得のときは判定しない

    if (イン && イン >= minDate && 予約不可[イン]) {
      インJ.textContent = '× この日はご予約いただけません。別の日をお選びください。';
      インJ.classList.add('ng');
      インJ.hidden = false;
      return;
    }

    if (イン && アウト && アウト > イン && !予約不可[イン]) {
      if (!範囲が空いている(イン, アウト)) {
        アウトJ.textContent = '× この期間には、すでにご予約が入っている日が含まれています。';
        アウトJ.classList.add('ng');
        アウトJ.hidden = false;
      }
    }
  }

  /** 第2候補に問題があるときだけ警告を出す（○の断定表示はしない） */
  function 第2候補判定() {
    var 表示 = document.getElementById('date2Judge');
    var イン  = date2InEl.value;
    var アウト = date2OutEl.value;

    // チェックアウト欄はチェックイン日の翌日以降しか選べないようにする
    date2OutEl.min = イン ? 翌日(イン) : minDate;

    表示.classList.remove('ok', 'ng');
    表示.hidden = true;

    if (!イン && !アウト) return;

    if (イン && アウト && アウト <= イン) {
      表示.textContent = '× チェックアウト日は、チェックイン日の翌日以降をお選びください。';
      表示.classList.add('ng');
      表示.hidden = false;
      return;
    }

    if (!空き状況あり) return;

    if (イン && イン >= minDate && 予約不可[イン]) {
      表示.textContent = '× この日はご予約いただけません。別の日をお選びください。';
      表示.classList.add('ng');
      表示.hidden = false;
      return;
    }

    if (イン && アウト && アウト > イン && イン >= minDate) {
      if (!範囲が空いている(イン, アウト)) {
        表示.textContent = '× この期間には、すでにご予約が入っている日が含まれています。';
        表示.classList.add('ng');
        表示.hidden = false;
      }
    }
  }

  checkinEl.addEventListener('change', function () {
    // 手入力でチェックイン日を変えたら、矛盾するチェックアウト日は消す
    if (checkoutEl.value && checkoutEl.value <= checkinEl.value) {
      checkoutEl.value = '';
    }
    選択を反映();
  });
  checkoutEl.addEventListener('change', 選択を反映);
  date2InEl.addEventListener('change', function () {
    if (date2OutEl.value && date2OutEl.value <= date2InEl.value) {
      date2OutEl.value = '';
    }
    第2候補判定();
  });
  date2OutEl.addEventListener('change', 第2候補判定);

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
        判定表示();
        第2候補判定();
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

    if (!data.checkin) {
      ng('checkin', 'チェックイン日をご入力ください。');
    } else if (data.checkin < minDate) {
      ng('checkin', 'チェックイン日は' + minDateLabel +
                  '以降の日付をお選びください。（ご予約は2日前まで承っております）');
    }

    if (!data.checkout) {
      ng('checkout', 'チェックアウト日をご入力ください。');
    } else if (data.checkin && data.checkout <= data.checkin) {
      ng('checkout', 'チェックアウト日は、チェックイン日の翌日以降をお選びください。');
    }

    if (data.date2Checkin && !data.date2Checkout) {
      ng('date2Checkout', '第2候補のチェックアウト日もお選びください。');
    }
    if (!data.date2Checkin && data.date2Checkout) {
      ng('date2Checkin', '第2候補のチェックイン日もお選びください。');
    }
    if (data.date2Checkin && data.date2Checkin < minDate) {
      ng('date2Checkin', '第2候補のチェックイン日は' + minDateLabel +
                  '以降の日付をお選びください。（ご予約は2日前まで承っております）');
    }
    if (data.date2Checkin && data.date2Checkout && data.date2Checkout <= data.date2Checkin) {
      ng('date2Checkout', '第2候補のチェックアウト日は、チェックイン日の翌日以降をお選びください。');
    }

    // カレンダーを読み込めているときだけ確認する
    // （読み込めていない場合は送信を通し、GAS側で最終判断します）
    if (空き状況あり && data.checkin && data.checkout && data.checkout > data.checkin) {
      if (!範囲が空いている(data.checkin, data.checkout)) {
        ng('checkout', 'ご希望の期間には、すでにご予約が入っている日が含まれております。日程をご確認ください。');
      }
    }
    if (空き状況あり && data.date2Checkin && data.date2Checkout &&
        data.date2Checkout > data.date2Checkin) {
      if (!範囲が空いている(data.date2Checkin, data.date2Checkout)) {
        ng('date2Checkin', '第2候補の期間には、すでにご予約が入っている日が含まれております。日程をご確認ください。');
      }
    }

    if (!data.checkinTime) ng('checkinTime', 'チェックイン予定時刻をお選びください。');
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

    var チェックイン  = f.checkin.value;
    var チェックアウト = f.checkout.value;
    var 泊 = (チェックイン && チェックアウト && チェックアウト > チェックイン)
              ? 泊数を計算(チェックイン, チェックアウト) : 0;

    return {
      name:        val('name'),
      email:       val('email'),
      tel:         val('tel'),
      checkin:     チェックイン,
      checkout:    チェックアウト,
      nights:      泊 ? (泊 + '泊') : '',
      nightsCount: 泊,
      date2Checkin:  f.date2Checkin.value,
      date2Checkout: f.date2Checkout.value,
      checkinTime: f.checkinTime.value,
      adults:      f.adults.value,
      children:    f.children.value,
      childAges:   val('childAges'),
      experiences: experiences.join('、'),
      source:      f.source.value,
      message:     val('message'),
      company:     val('company')   // honeypot（人は空のまま）
    };
  }

  /* -------------------------------------------------------
     5. 送信完了画面へ切り替える
     ------------------------------------------------------- */
  function showThanks() {
    var intro  = document.getElementById('introSection');
    var notice = document.getElementById('noticeSection');
    if (intro)  intro.hidden = true;
    if (notice) notice.hidden = true;
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
