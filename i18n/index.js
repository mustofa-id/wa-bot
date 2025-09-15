import en from "./en.json" with { type: 'json' };
import id from "./id.json" with { type: 'json' };

/**
 * To add more language, add <lang_id>.json file in i18n dir
 * and import-export it here just like `en`. Keys must same
 * as `en.json` file.
 */

export { en, id };
