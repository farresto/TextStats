/* English function-word classes used by the report's word-type toggles.
 * Each word belongs to ONE class only (the most common use), because words are
 * classified on their own, without reading the sentence around them. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TextStatsWordClasses = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Order of the toggles in the report. Nouns, verbs, adjectives and adverbs come from the
  // word lists in vendor/lexicon (looked up by the main process); "other" is everything else.
  const CLASSES = [
    { key: 'nouns' }, { key: 'verbs' }, { key: 'adjectives' }, { key: 'adverbs' },
    { key: 'pronouns' }, { key: 'determiners' }, { key: 'articles' }, { key: 'prepositions' },
    { key: 'conjunctions' }, { key: 'interjections' }, { key: 'numbers' }, { key: 'other' },
  ];

  const words = (s) => s.trim().split(/\s+/);

  const LISTS_EN = {
    articles: words('a an the'),

    pronouns: words(`
      i me my mine myself you your yours yourself yourselves he him his himself she her hers herself
      it its itself we us our ours ourselves they them their theirs themselves
      who whom whose which what whoever whomever whatever whichever that
      anybody anyone anything everybody everyone everything nobody none nothing
      somebody someone something oneself thee thou thy thine ye y'all
      i'm i've i'd i'll you're you've you'd you'll he's he'd he'll she's she'd she'll
      it's it'd it'll we're we've we'd we'll they're they've they'd they'll
      that's that'll that'd who's who'd who'll who've what's what'd what'll
      there's here's somebody's someone's everybody's everyone's nobody's
    `),

    determiners: words(`
      this these those each every either neither some any no all both few fewer
      many much more most several enough such other another little less least
      certain various whichever whatsoever
    `),

    prepositions: words(`
      about above across after against along alongside amid amidst among amongst around aboard atop
      at before behind below beneath beside besides between beyond by circa concerning considering
      despite down during except excepting excluding following for from in including inside into
      near nearer nearest notwithstanding of off on onto opposite out outside over per regarding
      since through throughout till to toward towards under underneath unlike until unto up upon
      versus via with within without vs thru amongst o'er 'til
    `),

    conjunctions: words(`
      and but or nor so yet although though because unless whereas while whilst if whether
      than as lest once provided providing whenever wherever whereby albeit
    `),

    interjections: words(`
      oh ah aha ahh alas hey hi hello wow ouch oops uh um umm er erm hmm hm huh yeah yes
      okay ok ugh phew hurray hooray hurrah bravo eh gosh ooh oo shh shush whoa yay yikes
      bye goodbye ahem aw aww darn gee ha haha hah mm mmm nah nope yep yup oy ow psst ahoy boo
      bingo egad golly hallelujah amen eek jeez meh voila wham yo hush pshaw blah bah tut
    `),
  };

  // Spanish. "al" and "del" (a/de + el) count as prepositions; mi/tu/su and other
  // possessives count as pronouns, like his/her in English.
  const LISTS_ES = {
    articles: words('el la los las lo un una unos unas'),

    pronouns: words(`
      yo tú él ella ello nosotros nosotras vosotros vosotras ellos ellas usted ustedes vos
      me te se nos os le les mí ti conmigo contigo consigo
      mi mis tu tus su sus mío mía míos mías tuyo tuya tuyos tuyas suyo suya suyos suyas
      nuestro nuestra nuestros nuestras vuestro vuestra vuestros vuestras
      quien quienes quién quiénes cual cuales cuál cuáles qué cuyo cuya cuyos cuyas
      alguien nadie algo nada esto eso aquello cualquiera quienquiera
    `),

    determiners: words(`
      este esta estos estas ese esa esos esas aquel aquella aquellos aquellas
      algún alguno alguna algunos algunas ningún ninguno ninguna ningunos ningunas
      cada todo toda todos todas otro otra otros otras mucho mucha muchos muchas
      poco poca pocos pocas varios varias tanto tanta tantos tantas bastante bastantes
      demasiado demasiada demasiados demasiadas cierto cierta ciertos ciertas ambos ambas
      cuanto cuanta cuantos cuantas cuánto cuánta cuántos cuántas más menos
      mismo misma mismos mismas tal tales sendos sendas cualesquiera
    `),

    prepositions: words(`
      a ante bajo cabe con contra de desde durante en entre hacia hasta mediante
      para por según sin so sobre tras versus vía excepto salvo al del
    `),

    conjunctions: words(`
      y e ni o u pero sino mas aunque porque pues que si mientras conque como
      cuando donde siquiera
    `),

    interjections: words(`
      ah ay oh eh uf ojalá hola adiós olé bah huy uy caramba caray hala ea guau
      ja jaja jajaja bravo ejem hurra puaj puf ush chist chitón ey buah sí
    `),
  };

  const UNITS_EN = words(`zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen
    sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty ninety
    hundred thousand million billion trillion dozen`);
  const ORDINALS_EN = words(`zeroth first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth
    thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth twentieth thirtieth
    fortieth fiftieth sixtieth seventieth eightieth ninetieth hundredth thousandth millionth billionth trillionth`);
  const NUMBERS_EN = new Set([...UNITS_EN, ...ORDINALS_EN, 'hundreds', 'thousands', 'millions', 'billions', 'dozens']);

  const UNITS_ES = words(`cero uno dos tres cuatro cinco seis siete ocho nueve diez once doce trece catorce quince
    dieciséis diecisiete dieciocho diecinueve veinte veintiuno veintiún veintiuna veintidós veintitrés veinticuatro
    veinticinco veintiséis veintisiete veintiocho veintinueve treinta cuarenta cincuenta sesenta setenta ochenta
    noventa cien ciento cientos doscientos doscientas trescientos trescientas cuatrocientos cuatrocientas quinientos
    quinientas seiscientos seiscientas setecientos setecientas ochocientos ochocientas novecientos novecientas
    mil miles millón millones billón billones docena docenas`);
  // Ordinals in every gender/number form (primero, primera, primeros, primeras ...).
  const ORD_ES_STEMS = words(`primer segund tercer cuart quint sext séptim octav noven décim undécim duodécim
    vigésim trigésim cuadragésim quincuagésim sexagésim septuagésim octogésim nonagésim centésim milésim millonésim`);
  const ORDINALS_ES = ['primer', 'tercer'];
  for (const st of ORD_ES_STEMS) for (const end of ['o', 'a', 'os', 'as']) ORDINALS_ES.push(st + end);
  const NUMBERS_ES = new Set([...UNITS_ES, ...ORDINALS_ES]);

  function buildMap(lists) {
    const map = new Map();
    // First listed class wins if a word were ever listed twice.
    for (const key of ['articles', 'pronouns', 'determiners', 'prepositions', 'conjunctions', 'interjections']) {
      for (const w of lists[key]) if (!map.has(w)) map.set(w, key);
    }
    return map;
  }
  const MAPS = { en: buildMap(LISTS_EN), es: buildMap(LISTS_ES) };
  const NUMBER_WORDS = { en: NUMBERS_EN, es: NUMBERS_ES };

  function isNumber(w, lang) {
    // 7, 1,000, 3.14, 1990s, 21st, 2nd, 3rd, 4th, 1º, 2ª, 1er, 3.º
    if (/^\p{N}[\p{N}.,]*(st|nd|rd|th|s|º|ª|\.º|\.ª|er|ro|ra|do|da|to|ta|vo|va|no|na|mo|ma)?$/u.test(w)) return true;
    const set = NUMBER_WORDS[lang] || NUMBERS_EN;
    if (set.has(w)) return true;
    // twenty-one, twenty-first
    if (w.includes('-')) return w.split('-').every((p) => set.has(p));
    return false;
  }

  function classify(word, lang = 'en') {
    if (isNumber(word, lang)) return 'numbers';
    return (MAPS[lang] || MAPS.en).get(word) || null;
  }

  return { CLASSES, classify };
});
