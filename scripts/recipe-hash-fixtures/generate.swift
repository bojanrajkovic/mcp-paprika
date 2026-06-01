import Foundation
import CoreData
import CryptoKit

// Emits ground-truth {recipe, expectedHash} fixtures by driving the shipped
// Paprika.framework's real Recipe.hashValues over synthetic recipes we control.

let fwPath = ProcessInfo.processInfo.environment["PAPRIKA_FRAMEWORK"]
  ?? "/Applications/Paprika Recipe Manager 3.app/Contents/Frameworks/Paprika.framework"
let bundle = Bundle(path: fwPath)!; _ = bundle.load()
let handle = dlopen(fwPath + "/Paprika", RTLD_NOW)!
let sym = dlsym(handle, "$s7Paprika6RecipeC10hashValuesSaySo8NSObjectCGvg")!
func hashValues(_ o: NSManagedObject) -> [NSObject] {
    unsafeBitCast(call_swift_self_getter(sym, Unmanaged.passUnretained(o).toOpaque()), to: [NSObject].self)
}
func sha256hex(_ d: Data) -> String { SHA256.hash(data: d).map { String(format: "%02X", $0) }.joined() }

let model = NSManagedObjectModel(contentsOf: bundle.url(forResource: "Paprika", withExtension: "momd")!)!
let coord = NSPersistentStoreCoordinator(managedObjectModel: model)
try coord.addPersistentStore(ofType: NSInMemoryStoreType, configurationName: nil, at: nil, options: nil)
let ctx = NSManagedObjectContext(concurrencyType: .privateQueueConcurrencyType)
ctx.persistentStoreCoordinator = coord

// Our Recipe field -> Core Data attribute name (mostly identical; description differs).
let ATTR: [String: String] = ["description": "descriptionText"]
// The hashed string/number/bool fields we set on the Core Data object (camelCase Recipe names).
// Empty handling is encoded per-spec: NSNull() => set nil; "" => set empty string.
let SETTABLE = ["name", "ingredients", "directions", "description", "notes", "prepTime", "cookTime",
                "totalTime", "servings", "difficulty", "rating", "created", "imageUrl", "photo",
                "photoHash", "photoLarge", "source", "sourceUrl", "onFavorites", "inTrash",
                "isPinned", "scale", "nutritionalInfo"]

func makeCategory(_ uid: String) -> NSManagedObject {
    let c = NSEntityDescription.insertNewObject(forEntityName: "RecipeCategory", into: ctx)
    c.setValue(uid, forKey: "uid"); c.setValue("name-\(uid)", forKey: "name")
    c.setValue(0, forKey: "orderFlag"); c.setValue(false, forKey: "isSynced")
    return c
}

// Fixed instant for `created` (a Core Data Date). The framework formats it to a
// string inside hashValues; we read that formatted string back out (array index 2).
let createdDate = Date(timeIntervalSince1970: 1_710_408_413)

func build(_ spec: [String: Any], _ cats: [String]) -> NSManagedObject {
    let r = NSEntityDescription.insertNewObject(forEntityName: "Recipe", into: ctx)
    for k in SETTABLE where k != "created" {
        let attr = ATTR[k] ?? k
        let v = spec[k]
        if v == nil || v is NSNull { r.setValue(nil, forKey: attr) } else { r.setValue(v, forKey: attr) }
    }
    r.setValue(createdDate, forKey: "created")
    for b in ["isSynced", "photoIsDownloaded", "photoIsUploaded"] { r.setValue(false, forKey: b) }
    r.setValue(Set(cats.map(makeCategory)), forKey: "categories")
    r.setValue(nil, forKey: "syncHash")
    return r
}

// JSON helpers for emitting the recipe in our camelCase Recipe shape.
func j(_ v: Any?) -> Any {
    if v == nil || v is NSNull { return NSNull() }
    return v!
}

// Each spec is the set of values we want; omitted optionals default to NSNull (null).
// `cats` is the category UID list (insertion order is irrelevant — the framework sorts).
struct Case { let name: String; let spec: [String: Any]; let cats: [String] }

let baseCreated = "2024-03-14 09:26:53"
let cases: [Case] = [
    Case(name: "minimal-empty-nulls", spec: [
        "name": "Plain", "ingredients": "", "directions": "", "rating": 0, "created": baseCreated,
        "imageUrl": "", "onFavorites": false, "inTrash": false, "isPinned": false,
    ], cats: []),
    Case(name: "all-optionals-null", spec: [
        "name": "Null Optionals", "ingredients": "x", "directions": "y", "rating": 0, "created": baseCreated,
        "description": NSNull(), "notes": NSNull(), "prepTime": NSNull(), "cookTime": NSNull(),
        "totalTime": NSNull(), "servings": NSNull(), "difficulty": NSNull(), "imageUrl": NSNull(),
        "photo": NSNull(), "photoHash": NSNull(), "photoLarge": NSNull(), "source": NSNull(),
        "sourceUrl": NSNull(), "scale": NSNull(), "nutritionalInfo": NSNull(),
        "onFavorites": false, "inTrash": false, "isPinned": false,
    ], cats: []),
    Case(name: "all-optionals-empty-string", spec: [
        "name": "Empty Strings", "ingredients": "x", "directions": "y", "rating": 0, "created": baseCreated,
        "description": "", "notes": "", "prepTime": "", "cookTime": "", "totalTime": "", "servings": "",
        "difficulty": "", "imageUrl": "", "photo": "", "photoHash": "", "photoLarge": "", "source": "",
        "sourceUrl": "", "scale": "", "nutritionalInfo": "", "onFavorites": false, "inTrash": false, "isPinned": false,
    ], cats: []),
    Case(name: "fully-populated", spec: [
        "name": "Full Recipe", "ingredients": "2 cups flour\n1/2 tsp salt", "directions": "Mix.\nBake at 350°F.",
        "description": "A tasty thing", "notes": "best with butter", "prepTime": "15 min", "cookTime": "30 min",
        "totalTime": "45 min", "servings": "4-6", "difficulty": "Easy", "rating": 4, "created": baseCreated,
        "imageUrl": "https://example.com/img.jpg", "photo": "ABC.jpg", "photoHash": "DEADBEEF",
        "photoLarge": "DEF.jpg", "source": "Test Kitchen", "sourceUrl": "https://example.com/r?id=1/2",
        "onFavorites": true, "inTrash": false, "isPinned": true, "scale": "2", "nutritionalInfo": "200 cal",
    ], cats: []),
    Case(name: "one-category", spec: [
        "name": "Single Cat", "ingredients": "x", "directions": "y", "rating": 0, "created": baseCreated,
        "imageUrl": "", "onFavorites": false, "inTrash": false, "isPinned": false,
    ], cats: ["F3830F75-2632-4294-8309-E0B58AF9CDDA"]),
    Case(name: "many-categories-mixed-case", spec: [
        "name": "Multi Cat", "ingredients": "x", "directions": "y", "rating": 2, "created": baseCreated,
        "imageUrl": "", "onFavorites": false, "inTrash": false, "isPinned": false,
    ], cats: ["F3830F75-2632-4294-8309-E0B58AF9CDDA", "81ED2F6A-7128-4915-90D3-484C26F3A564",
              "8adefad1-3aad-4e20-a481-39b34f3fda8a", "Zebra-CAT", "apple-cat"]),
    Case(name: "unicode-and-slashes", spec: [
        "name": "Crème Brûlée ½", "ingredients": "¼ cup\n½ tsp", "directions": "Heat to 180°C / 350°F. Stir w/ care.",
        "description": "façade — naïve", "rating": 5, "created": baseCreated, "imageUrl": "",
        "source": "Café", "sourceUrl": "https://a.test/path/to/x", "onFavorites": false, "inTrash": false, "isPinned": false,
    ], cats: ["8adefad1-3aad-4e20-a481-39b34f3fda8a"]),
    // NOTE: no trashed/deleted ground-truth case. The framework's hashValues emits the
    // real in_trash/deleted, but the app never STORES such a hash — it keeps the live
    // (in_trash=false) hash across trash flips (#125). computeRecipeHash pins both false
    // to reproduce the stored hash; trash-independence is covered by a unit test.
]

func recipeJson(_ c: Case, createdStr: String) -> [String: Any] {
    var out: [String: Any] = [:]
    // Our Recipe camelCase shape — pull from spec, defaulting unset optionals to null.
    out["uid"] = "FIXTURE-\(c.name.uppercased())"
    out["hash"] = ""  // input hash is irrelevant to compute
    out["name"] = j(c.spec["name"])
    out["categories"] = c.cats
    out["ingredients"] = (c.spec["ingredients"] as? String) ?? ""
    out["directions"] = (c.spec["directions"] as? String) ?? ""
    for k in ["description", "notes", "prepTime", "cookTime", "totalTime", "servings", "difficulty",
              "imageUrl", "photo", "photoHash", "photoLarge", "source", "sourceUrl", "scale", "nutritionalInfo"] {
        out[k] = j(c.spec[k])
    }
    out["rating"] = (c.spec["rating"] as? Int) ?? 0
    out["created"] = createdStr
    out["photoUrl"] = NSNull()
    out["onFavorites"] = (c.spec["onFavorites"] as? Bool) ?? false
    out["inTrash"] = (c.spec["inTrash"] as? Bool) ?? false
    out["isPinned"] = (c.spec["isPinned"] as? Bool) ?? false
    out["onGroceryList"] = false
    out["deleted"] = false
    return out
}

ctx.performAndWait {
    var fixtures: [[String: Any]] = []
    for c in cases {
        // Set the uid on the Core Data object too so it's part of the hash.
        let r = build(c.spec, c.cats)
        r.setValue("FIXTURE-\(c.name.uppercased())", forKey: "uid")
        let arr = hashValues(r)
        let data = try! JSONSerialization.data(withJSONObject: arr, options: [])
        let hash = sha256hex(data)
        let createdStr = (arr[2] as? String) ?? ""  // index 2 = created (alphabetical: categories, cook_time, created)
        fixtures.append(["name": c.name, "recipe": recipeJson(c, createdStr: createdStr), "expectedHash": hash,
                         "frameworkJson": String(data: data, encoding: .utf8) ?? ""])
    }
    let out = try! JSONSerialization.data(withJSONObject: fixtures, options: [.prettyPrinted, .sortedKeys])
    FileHandle.standardOutput.write(out)
}
