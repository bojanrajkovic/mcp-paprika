// Generated from docs/wire-captures/reference.har.json — do not edit
// Regenerate with: npx tsx scripts/generate-har-fixtures.ts

import { fromTraffic } from "@msw/source/traffic";
import type Har from "har-format";
import type { HttpHandler } from "msw";

/* eslint-disable */

const har = {
  log: {
    version: "1.2",
    creator: {
      name: "mitmproxy + decode-capture.py",
      version: "1.0",
    },
    entries: [
      {
        comment: "GET sync status (entity count catalog)",
        startedDateTime: "2026-05-26T11:12:44.316340+00:00",
        time: 0,
        request: {
          method: "GET",
          url: "https://paprikaapp.com/api/v2/sync/status/",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Authorization",
              value: "[REDACTED]",
            },
          ],
          queryString: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Content-Type",
              value: "application/json",
            },
          ],
          content: {
            size: 257,
            mimeType: "application/json",
            text: '{"result": {"categories": 89, "recipes": 952, "photos": 8, "groceries": 1323, "grocerylists": 26, "groceryaisles": 421, "groceryingredients": 75, "meals": 41, "mealtypes": 60, "bookmarks": 0, "pantry": 950, "pantrylocations": 0, "menus": 2, "menuitems": 2}}',
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: 257,
        },
        cache: {},
        timings: {
          send: 0,
          wait: 0,
          receive: 0,
        },
      },
      {
        comment: "GET grocery lists (startup sync)",
        startedDateTime: "2026-05-26T11:12:44.316571+00:00",
        time: 0,
        request: {
          method: "GET",
          url: "https://paprikaapp.com/api/v2/sync/grocerylists/",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Authorization",
              value: "[REDACTED]",
            },
          ],
          queryString: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Content-Type",
              value: "application/json",
            },
          ],
          content: {
            size: 182,
            mimeType: "application/json",
            text: '{"result": [{"uid": "9E12FCF54A89FC52EA8E1C5DA1BDA62A6617ED8BDC2AEB6F291B93C7A399F6F6", "name": "My Grocery List", "order_flag": 0, "is_default": true, "reminders_list": "Paprika"}]}',
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: 182,
        },
        cache: {},
        timings: {
          send: 0,
          wait: 0,
          receive: 0,
        },
      },
      {
        comment: "GET grocery aisles (startup sync)",
        startedDateTime: "2026-05-26T11:12:44.316603+00:00",
        time: 0,
        request: {
          method: "GET",
          url: "https://paprikaapp.com/api/v2/sync/groceryaisles/",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Authorization",
              value: "[REDACTED]",
            },
          ],
          queryString: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Content-Type",
              value: "application/json",
            },
          ],
          content: {
            size: 3217,
            mimeType: "application/json",
            text: '{"result": [{"uid": "B49385D0-881F-4C7D-9C41-3CFF26490EED", "name": "Pasta", "order_flag": 29}, {"uid": "1A58CBF1-47A9-45C9-B8C7-7B1866F58EA8", "name": "Oils & Vinegars", "order_flag": 28}, {"uid": "0EA0B49D-5D07-4468-B8B6-783B1F41B9D1", "name": "Spices", "order_flag": 27}, {"uid": "76CFAFC5-7A60-4896-AD9B-05D9C5EC840F", "name": "Seafood", "order_flag": 26}, {"uid": "3F93595AB64D4BEA46CEB1EC7DFA26D39592A5383F86479A097FCBA7E0E0F7AF", "name": "Baby Products", "order_flag": 0}, {"uid": "59F9016630B54811B381C4A6FC5932BD9401D0957D9F8F0AA31D30057E0B4796", "name": "Health and Beauty", "order_flag": 11}, {"uid": "75DDAF84BB511A4C01E9CAADB18F7381FE3C3A2F358FFE78089BF3BEC18220DC", "name": "Bakery", "order_flag": 1}, {"uid": "855060A0FFB3363A5E466172781465A13980564E58959750B700FD1D30AFABAC", "name": "Home and Garden", "order_flag": 12}, {"uid": "12304D0F1A64F772E413322BD03445ADD546F7528D9628F999DBEE3B7C7819B7", "name": "Baking Goods", "order_flag": 2}, {"uid": "F467DB0B4693D48071CF16A4D9576DA358666D36AE0E4699F03D54BA505853E2", "name": "Oils and Dressings", "order_flag": 16}, {"uid": "AFADC523FB4CFA907914740E22016338CBD90DDFA42177B87F9E46F2B376EB28", "name": "Breads and Cereals", "order_flag": 3}, {"uid": "E3852B4867C7C73E84F7359453ABF340242451228684C16C2DFF718BC01870A7", "name": "International Cuisine", "order_flag": 13}, {"uid": "893ABA5A4A5B78D7350B2CF92C545B7E6857C2EFBBF47A674899F1BEF045C7F8", "name": "Beverages", "order_flag": 4}, {"uid": "CAE5ADDAAB3EAE7D474EC14086EB0429CAE123F3E5865BDF4879183A7D444BE1", "name": "Snacks", "order_flag": 23}, {"uid": "206AC4F9-80B6-4259-9F24-8A506ADFDC3A", "name": "Test Aisle 2", "order_flag": 25}, {"uid": "02C70C54CAA4A4F7A7CAE38B5169974AF7B10941C8659E805EFC31F0A71314B8", "name": "Canned and Jar Goods", "order_flag": 6}, {"uid": "BA4C9E950F0978E0EED5A90ACFEE89E2AFECE3333E512D44418766DD1C7FEE4F", "name": "Meat", "order_flag": 14}, {"uid": "78C2FD5B5D87D022886CCA1087AD359816A842A516987B8DE973B1B81BC3C0EA", "name": "Spices and Seasonings", "order_flag": 21}, {"uid": "61245C53D39400090D38E73689BAB3E8513C6D95E76E1E6947D914A73F8692DF", "name": "Beer, Wine and Spirits", "order_flag": 5}, {"uid": "F94467760BF4BC6B9521FFA9329D0F1DBCCA0F5AC0808BD8552FB375A565FB9E", "name": "Produce", "order_flag": 19}, {"uid": "5CB0B42660589925C804543D433BA0764DAB859487E5A9ED855481DCBFEC1F06", "name": "Miscellaneous", "order_flag": 15}, {"uid": "621D77DB8E334CB6662F06C5C6F67A08335E763A658ED4E1653AE226AA79F0C2", "name": "Pet Products", "order_flag": 18}, {"uid": "37CEE1DBD7FFC9FFE189BB1390B090778D58B4E8BA108C179A054664A98D2BDA", "name": "Frozen Foods", "order_flag": 10}, {"uid": "A51E88F0FFF8CC39EDF90444E059946E0FB4BC2A1F4712A3402E5F9F31C3AA91", "name": "Pasta, Rice and Beans", "order_flag": 17}, {"uid": "7D60C73EE79492063E1D7105C9BC7383D9A1A773F99032C0885E9C24C83209E1", "name": "Sauces and Condiments", "order_flag": 20}, {"uid": "4B91A0242365133B2E6E04A9EAC45D54CB077E964035FE00225400F125613F4F", "name": "Cleaning Supplies", "order_flag": 7}, {"uid": "6AC3FE23C8DF0E08E6D1256C1D027B291E2F19A4EC1DF4C3D83118599A3F51C9", "name": "Dairy", "order_flag": 8}, {"uid": "32B4A36BED4F4CC1154BE1BA656A0EAF0B892B5CDFB5131DB3F351F82008262E", "name": "Deli", "order_flag": 9}]}',
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: 3217,
        },
        cache: {},
        timings: {
          send: 0,
          wait: 0,
          receive: 0,
        },
      },
      {
        comment: "GET grocery items (startup sync)",
        startedDateTime: "2026-05-26T11:12:44.316608+00:00",
        time: 0,
        request: {
          method: "GET",
          url: "https://paprikaapp.com/api/v2/sync/groceries/",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Authorization",
              value: "[REDACTED]",
            },
          ],
          queryString: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Content-Type",
              value: "application/json",
            },
          ],
          content: {
            size: 14,
            mimeType: "application/json",
            text: '{"result": []}',
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: 14,
        },
        cache: {},
        timings: {
          send: 0,
          wait: 0,
          receive: 0,
        },
      },
      {
        comment: "POST app statistics (telemetry on startup)",
        startedDateTime: "2026-05-26T11:12:44.316614+00:00",
        time: 0,
        request: {
          method: "POST",
          url: "https://paprikaapp.com/api/v2/statistics/",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Authorization",
              value: "[REDACTED]",
            },
          ],
          queryString: [],
          headersSize: -1,
          bodySize: 210,
          postData: {
            mimeType: "application/json",
            text: '[{"install_uid": "00000000-0000-4000-a000-000000000000", "is_activating_now": false, "os_version": "macOS 26.4.1", "app_version": "3.8.4", "os": "macOS", "sync_email": "[REDACTED_EMAIL]", "is_activated": true}]',
          },
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Content-Type",
              value: "application/json",
            },
          ],
          content: {
            size: 16,
            mimeType: "application/json",
            text: '{"result": true}',
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: 16,
        },
        cache: {},
        timings: {
          send: 0,
          wait: 0,
          receive: 0,
        },
      },
      {
        comment: "GET pantry items (startup sync)",
        startedDateTime: "2026-05-26T11:12:44.316631+00:00",
        time: 0,
        request: {
          method: "GET",
          url: "https://paprikaapp.com/api/v2/sync/pantry/",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Authorization",
              value: "[REDACTED]",
            },
          ],
          queryString: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Content-Type",
              value: "application/json",
            },
          ],
          content: {
            size: 3941,
            mimeType: "application/json",
            text: '{"result": [{"uid": "A4402CA4-1919-4D88-B22E-165559A32D91", "ingredient": "Red Enchilada Sauce", "aisle": "International", "expiration_date": "2028-05-21 00:00:00", "has_expiration": true, "in_stock": true, "purchase_date": "2026-05-21 00:00:00", "quantity": "1 ct", "aisle_uid": "", "location_uid": null, "notes": null}, {"uid": "FE332579-EA7D-458B-A02E-F4CF02EAADAA", "ingredient": "Shredded Mozzarella", "aisle": "Dairy", "expiration_date": "2026-06-25 00:00:00", "has_expiration": true, "in_stock": true, "purchase_date": "2026-05-21 00:00:00", "quantity": "1 ct", "aisle_uid": "", "location_uid": null, "notes": null}, {"uid": "6E956D5C-EE11-4241-8224-F3BC8BD3B9A5", "ingredient": "Butter Bread", "aisle": "Bread", "expiration_date": "2026-06-04 00:00:00", "has_expiration": true, "in_stock": true, "purchase_date": "2026-05-21 00:00:00", "quantity": "1 ct", "aisle_uid": "", "location_uid": null, "notes": null}, {"uid": "9E72D5BF-8482-4878-B969-716279CCC112", "ingredient": "Pasta and Cheddar", "aisle": "Pasta", "expiration_date": "2027-05-21 00:00:00", "has_expiration": true, "in_stock": true, "purchase_date": "2026-05-21 00:00:00", "quantity": "2 ct", "aisle_uid": "", "location_uid": null, "notes": null}, {"uid": "B203F0BC-C12C-4A95-80B9-2620E4DE845F", "ingredient": "Neufchatel Cheese", "aisle": "Dairy", "expiration_date": "2026-06-04 00:00:00", "has_expiration": true, "in_stock": true, "purchase_date": "2026-05-21 00:00:00", "quantity": "8 oz", "aisle_uid": "", "location_uid": null, "notes": null}, {"uid": "352EC5F7-532D-44BD-9A76-70F763639EAC", "ingredient": "Chopped Green Chiles", "aisle": "International", "expiration_date": "2028-05-21 00:00:00", "has_expiration": true, "in_stock": true, "purchase_date": "2026-05-21 00:00:00", "quantity": "1 ct", "aisle_uid": "", "location_uid": null, "notes": null}, {"uid": "B0733FA2-02DE-4D8D-9431-5C823A7B67C2", "ingredient": "Flour Tortillas", "aisle": "Bread", "expiration_date": "2026-06-11 00:00:00", "has_expiration": true, "in_stock": true, "purchase_date": "2026-05-21 00:00:00", "quantity": "10 ct", "aisle_uid": "", "location_uid": null, "notes": null}, {"uid": "E6F2BB89-23A1-41C4-B62D-E10EE7489C13", "ingredient": "Parmesan", "aisle": "Dairy", "expiration_date": "2027-02-21 00:00:00", "has_expiration": true, "in_stock": true, "purchase_date": "2026-05-21 00:00:00", "quantity": "1 ct", "aisle_uid": "", "location_uid": null, "notes": null}, {"uid": "4AB1B71C-70D0-40BD-817F-9C03F8F26311", "ingredient": "Mexican Shredded Cheese Blend", "aisle": "Dairy", "expiration_date": "2026-06-25 00:00:00", "has_expiration": true, "in_stock": true, "purchase_date": "2026-05-21 00:00:00", "quantity": "1 ct", "aisle_uid": "", "location_uid": null, "notes": null}, {"uid": "86B32E66-1E1B-4DC5-BEC2-3736252418A2", "ingredient": "Boston Lettuce", "aisle": "Produce", "expiration_date": "2026-05-28 00:00:00", "has_expiration": true, "in_stock": true, "purchase_date": "2026-05-21 00:00:00", "quantity": "1 ct", "aisle_uid": "", "location_uid": null, "notes": null}, {"uid": "3FAEB8DA-4AA7-42D1-8391-9B87F5F1875A", "ingredient": "Roma Tomato", "aisle": "Produce", "expiration_date": "2026-05-28 00:00:00", "has_expiration": true, "in_stock": true, "purchase_date": "2026-05-21 00:00:00", "quantity": "0.9 lb", "aisle_uid": "", "location_uid": null, "notes": null}, {"uid": "19E03F8D-865B-43FE-A134-73FF804D9A1A", "ingredient": "Mini Cucumbers", "aisle": "Produce", "expiration_date": "2026-05-31 00:00:00", "has_expiration": true, "in_stock": true, "purchase_date": "2026-05-21 00:00:00", "quantity": "1 ct", "aisle_uid": "", "location_uid": null, "notes": null}, {"uid": "4ED28FBD-81A6-47CB-AF60-9720C0CD641F", "ingredient": "Ground Beef 85% Lean 15% Fat", "aisle": "Meat", "expiration_date": "2026-08-21 00:00:00", "has_expiration": true, "in_stock": true, "purchase_date": "2026-05-21 00:00:00", "quantity": "1.24 lb", "aisle_uid": "", "location_uid": null, "notes": null}]}',
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: 3941,
        },
        cache: {},
        timings: {
          send: 0,
          wait: 0,
          receive: 0,
        },
      },
      {
        comment: "GET meal types catalog (user-customizable, like aisles)",
        startedDateTime: "2026-05-26T11:13:14.629418+00:00",
        time: 0,
        request: {
          method: "GET",
          url: "https://paprikaapp.com/api/v2/sync/mealtypes/",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Authorization",
              value: "[REDACTED]",
            },
          ],
          queryString: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Content-Type",
              value: "application/json",
            },
          ],
          content: {
            size: 802,
            mimeType: "application/json",
            text: '{"result": [{"uid": "913D33C7FD39DB8C8C4514669B011F617D911345592CC77B309B812667959720", "name": "Breakfast", "color": "", "order_flag": 0, "original_type": 0, "export_all_day": false, "export_time": "08:00:00"}, {"uid": "74B7DE10D8791D7B501CB5DC41365994F2CC80227B7CE5CB2548E24AF26DC939", "name": "Lunch", "color": "", "order_flag": 1, "original_type": 1, "export_all_day": false, "export_time": "12:00:00"}, {"uid": "216713D08860CFA0D9787EA5C6CEBC8A8F5B73777F91C904853AC234BB9DF642", "name": "Dinner", "color": "", "order_flag": 2, "original_type": 2, "export_all_day": false, "export_time": "18:00:00"}, {"uid": "CAE5ADDAAB3EAE7D5AF8F19F3D0CEAC64E1ADE90C94A9BB3C9E5B8E2BA0D6F15", "name": "Snacks", "color": "", "order_flag": 3, "original_type": 3, "export_all_day": false, "export_time": "15:00:00"}]}',
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: 802,
        },
        cache: {},
        timings: {
          send: 0,
          wait: 0,
          receive: 0,
        },
      },
      {
        comment: "GET meals (full history, unpaginated \u2014 shows is_ingredient + scale fields)",
        startedDateTime: "2026-05-26T11:13:14.629624+00:00",
        time: 0,
        request: {
          method: "GET",
          url: "https://paprikaapp.com/api/v2/sync/meals/",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Authorization",
              value: "[REDACTED]",
            },
          ],
          queryString: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Content-Type",
              value: "application/json",
            },
          ],
          content: {
            size: 370,
            mimeType: "application/json",
            text: '{"result": [{"uid": "EXAMPLE-MEAL-UID", "recipe_uid": "EXAMPLE-RECIPE-UID", "name": "Example Recipe", "date": "2026-05-26 00:00:00", "type": 2, "type_uid": "216713D08860CFA0D9787EA5C6CEBC8A8F5B73777F91C904853AC234BB9DF642", "order_flag": 0, "is_ingredient": false, "scale": null}], "_note": "Synthetic example showing GET response shape (9 fields). Real UIDs redacted."}',
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: 370,
        },
        cache: {},
        timings: {
          send: 0,
          wait: 0,
          receive: 0,
        },
      },
      {
        comment: "GET recipe entries (uid+hash list, not full recipes)",
        startedDateTime: "2026-05-27T00:30:12.375757+00:00",
        time: 0,
        request: {
          method: "GET",
          url: "https://paprikaapp.com/api/v2/sync/recipes/",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Authorization",
              value: "[REDACTED]",
            },
          ],
          queryString: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Content-Type",
              value: "application/json",
            },
          ],
          content: {
            size: 387,
            mimeType: "application/json",
            text: '{"result": [{"uid": "014031E3-BC74-4CA8-B345-36EBE9C9794B", "hash": "CD0E76986FBBCB4BA2D2B5995E58712B5C1E783A98FED4055733CD9C73FEC5AE"}, {"uid": "014C5274-A7CA-4B91-949C-4256801DB6E1", "hash": "F5DE421BE696AA817057FB58B5A4728112FFF7B1C36E9E54382504814E37CD29"}, {"uid": "03268A0B-7EEA-4E2C-841B-3BC215C6608E", "hash": "77406F8A3BD7AC071F6DB56F5CA60AA5B51F4D7A5E9D62AC53DC6A2747590F74"}]}',
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: 531,
        },
        cache: {},
        timings: {
          send: 0,
          wait: 0,
          receive: 0,
        },
      },
      {
        comment: "GET individual recipe (full 28-field shape)",
        startedDateTime: "2026-05-27T00:30:12.376213+00:00",
        time: 0,
        request: {
          method: "GET",
          url: "https://paprikaapp.com/api/v2/sync/recipe/EXAMPLE-RECIPE-UID/",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Authorization",
              value: "[REDACTED]",
            },
          ],
          queryString: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Content-Type",
              value: "application/json",
            },
          ],
          content: {
            size: 843,
            mimeType: "application/json",
            text: '{"result": {"uid": "EXAMPLE-RECIPE-UID", "name": "Example Recipe", "ingredients": "3 medium garlic clov...", "directions": "Stir together garlic...", "description": "", "notes": "", "nutritional_info": "", "servings": "4 to 6", "difficulty": "", "prep_time": "50 mins", "cook_time": "5 hrs", "total_time": "", "source": "foodandwine.com", "source_url": "https://www.foodandw...", "image_url": "https://www.foodandw...", "photo": "0D65A1FD-53B5-41C7-9EB6-DEF2D52F22F2.jpg", "photo_hash": "34B60965F58DAAF4F4E7...", "photo_large": null, "scale": null, "hash": "EXAMPLE-HASH", "categories": [], "rating": 0, "in_trash": false, "is_pinned": false, "on_favorites": false, "on_grocery_list": false, "created": "2024-12-23 20:43:51", "photo_url": "http://s3.amazonaws...."}, "_note": "Single recipe fetch. Field values sanitized; structure is real."}',
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: 843,
        },
        cache: {},
        timings: {
          send: 0,
          wait: 0,
          receive: 0,
        },
      },
      {
        comment: "GET categories (fully hydrated)",
        startedDateTime: "2026-05-27T00:30:12.376301+00:00",
        time: 0,
        request: {
          method: "GET",
          url: "https://paprikaapp.com/api/v2/sync/categories/",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Authorization",
              value: "[REDACTED]",
            },
          ],
          queryString: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Content-Type",
              value: "application/json",
            },
          ],
          content: {
            size: 330,
            mimeType: "application/json",
            text: '{"result": [{"uid": "647E822C-434E-42D4-94A7-C42CC34A0246", "order_flag": 31, "name": "AIP", "parent_uid": null}, {"uid": "2F479ADE-7058-4C8F-B4EC-54BD3AD48E77", "order_flag": 31, "name": "Side Dishes", "parent_uid": null}, {"uid": "37BEB314-15B7-4A81-AD0B-3BA1F7CC5305", "order_flag": 30, "name": "Entrees", "parent_uid": null}]}',
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: 370,
        },
        cache: {},
        timings: {
          send: 0,
          wait: 0,
          receive: 0,
        },
      },
      {
        comment: "GET grocery ingredients (aisle mapping catalog)",
        startedDateTime: "2026-05-27T00:30:12.376390+00:00",
        time: 0,
        request: {
          method: "GET",
          url: "https://paprikaapp.com/api/v2/sync/groceryingredients/",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Authorization",
              value: "[REDACTED]",
            },
          ],
          queryString: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Content-Type",
              value: "application/json",
            },
          ],
          content: {
            size: 297,
            mimeType: "application/json",
            text: '{"result": [{"uid": "BA2732AA-AD01-4D74-8EAB-F86AFD4A07DB", "name": "mcp-cap clear-2", "aisle_uid": null}, {"uid": "6AA4E2A3-1651-4440-96C1-678E8709D5C0", "name": "mcp-cap clear-1", "aisle_uid": null}, {"uid": "0EDBBA3D-92C2-4C38-B357-59A85665F1CC", "name": "mcp-cap batch-3", "aisle_uid": null}]}',
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: 337,
        },
        cache: {},
        timings: {
          send: 0,
          wait: 0,
          receive: 0,
        },
      },
      {
        comment: "GET photos (recipe photo metadata)",
        startedDateTime: "2026-05-27T00:30:12.376447+00:00",
        time: 0,
        request: {
          method: "GET",
          url: "https://paprikaapp.com/api/v2/sync/photos/",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Authorization",
              value: "[REDACTED]",
            },
          ],
          queryString: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Content-Type",
              value: "application/json",
            },
          ],
          content: {
            size: 919,
            mimeType: "application/json",
            text: '{"result": [{"uid": "5C6784FE-B901-4BA4-A053-5CE0FD9FD082", "filename": "5C6784FE-B901-4BA4-A053-5CE0FD9FD082.jpg", "recipe_uid": "1732B280-7B68-4D49-9A94-576B4392D7B2", "order_flag": 0, "name": "1", "hash": "7A9CEEDA77CC30D0E94D6D42A800A98A79B26811DA2F250425AFD782B94B95DC"}, {"uid": "A25807CE-2ADE-4A65-B2B9-4447C3DD3D48-5407-00000622FFEDF2EB", "filename": "A25807CE-2ADE-4A65-B2B9-4447C3DD3D48-5407-00000622FFEDF2EB.jpg", "recipe_uid": "CE756545-3A8C-48F6-8850-A6964EB3E7B8-5407-00000621BF333FF4", "order_flag": 0, "name": "1", "hash": "E02603D96477AC7FE6C0DDA93EA3FF1D4E5676E0C72210222CC65EA5B86E3360"}, {"uid": "5A354915-3999-4C6A-997E-856A2E257E65-38682-00002576272D491F", "filename": "5A354915-3999-4C6A-997E-856A2E257E65-38682-00002576272D491F.jpg", "recipe_uid": "29222db3-8166-4a20-9080-cf0a3b222ab0", "order_flag": 0, "name": "1", "hash": "2C9CC2D22D1606AC9F4CF94592E6251CE00A40615735590F0531B946E2A0D1A2"}]}',
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: 958,
        },
        cache: {},
        timings: {
          send: 0,
          wait: 0,
          receive: 0,
        },
      },
      {
        comment: "GET pantry locations (404 \u2014 endpoint not implemented)",
        startedDateTime: "2026-05-27T00:30:12.376453+00:00",
        time: 0,
        request: {
          method: "GET",
          url: "https://paprikaapp.com/api/v2/sync/pantrylocations/",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Authorization",
              value: "[REDACTED]",
            },
          ],
          queryString: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: 404,
          statusText: "Not Found",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Content-Type",
              value: "application/json",
            },
          ],
          content: {
            size: 47,
            mimeType: "application/json",
            text: '{"error": {"code": 0, "message": "Not found."}}',
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: 47,
        },
        cache: {},
        timings: {
          send: 0,
          wait: 0,
          receive: 0,
        },
      },
      {
        comment: "GET menus (empty \u2014 test data cleaned up)",
        startedDateTime: "2026-05-27T00:30:12.376458+00:00",
        time: 0,
        request: {
          method: "GET",
          url: "https://paprikaapp.com/api/v2/sync/menus/",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Authorization",
              value: "[REDACTED]",
            },
          ],
          queryString: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Content-Type",
              value: "application/json",
            },
          ],
          content: {
            size: 14,
            mimeType: "application/json",
            text: '{"result": []}',
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: 14,
        },
        cache: {},
        timings: {
          send: 0,
          wait: 0,
          receive: 0,
        },
      },
      {
        comment: "GET menu items (empty \u2014 test data cleaned up)",
        startedDateTime: "2026-05-27T00:30:12.376461+00:00",
        time: 0,
        request: {
          method: "GET",
          url: "https://paprikaapp.com/api/v2/sync/menuitems/",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Authorization",
              value: "[REDACTED]",
            },
          ],
          queryString: [],
          headersSize: -1,
          bodySize: 0,
        },
        response: {
          status: 200,
          statusText: "OK",
          httpVersion: "HTTP/1.1",
          cookies: [],
          headers: [
            {
              name: "Content-Type",
              value: "application/json",
            },
          ],
          content: {
            size: 14,
            mimeType: "application/json",
            text: '{"result": []}',
          },
          redirectURL: "",
          headersSize: -1,
          bodySize: 14,
        },
        cache: {},
        timings: {
          send: 0,
          wait: 0,
          receive: 0,
        },
      },
    ],
  },
} as const;

interface Fixture {
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly requestBody: unknown;
  readonly responseBody: unknown;
}

function parseBody(text: string | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function buildFixtures() {
  const map = new Map<string, Fixture>();
  for (const entry of har.log.entries) {
    if (!entry.comment) continue;
    const req = entry.request as { postData?: { text?: string }; method: string; url: string };
    map.set(entry.comment, {
      method: req.method,
      url: req.url,
      status: entry.response.status,
      requestBody: parseBody(req.postData?.text),
      responseBody: parseBody(entry.response.content.text),
    });
  }
  return map;
}

const fixtureMap = buildFixtures();

export type FixtureKey =
  | "GET sync status (entity count catalog)"
  | "GET grocery lists (startup sync)"
  | "GET grocery aisles (startup sync)"
  | "GET grocery items (startup sync)"
  | "POST app statistics (telemetry on startup)"
  | "GET pantry items (startup sync)"
  | "GET meal types catalog (user-customizable, like aisles)"
  | "GET meals (full history, unpaginated — shows is_ingredient + scale fields)"
  | "GET recipe entries (uid+hash list, not full recipes)"
  | "GET individual recipe (full 28-field shape)"
  | "GET categories (fully hydrated)"
  | "GET grocery ingredients (aisle mapping catalog)"
  | "GET photos (recipe photo metadata)"
  | "GET pantry locations (404 — endpoint not implemented)"
  | "GET menus (empty — test data cleaned up)"
  | "GET menu items (empty — test data cleaned up)";

export function fixture(key: FixtureKey): Fixture {
  return fixtureMap.get(key)!;
}

export const handlers: ReadonlyArray<HttpHandler> = fromTraffic(har as unknown as Har.Har);
