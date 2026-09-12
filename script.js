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

/* ▼ 定員（一棟貸し 定員5名） */
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
