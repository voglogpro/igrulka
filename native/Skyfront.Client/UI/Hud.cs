using Godot;
using System;
using System.Collections.Generic;
using System.Text.Json;

namespace Skyfront.Client.UI;

public partial class Hud : CanvasLayer
{
    public event Action<string, string>? Command;
    public int Count => (int)_count.Value;
    private SpinBox _count = null!;
    private Label _resources = null!, _selection = null!, _selectionInfo = null!, _status = null!, _tool = null!, _clock = null!;
    private Control _menu = null!;
    private Control _selectionPanel = null!;
    private HBoxContainer _catalogRow = null!;
    private readonly List<Button> _startButtons = new();
    private readonly Dictionary<string, JsonElement> _buildings = new(), _weapons = new(), _troops = new();
    private readonly Dictionary<string, int> _purchaseCounts = new();
    private readonly Dictionary<string, Label> _buildingPrices = new();
    private readonly Dictionary<string, Label> _weaponStocks = new();
    private readonly Dictionary<string, int> _inventory = new();
    private string _tab = "Город";
    private bool _ready;
    private Control _root = null!;
    private Rect2? _dragBox;
    public void SelectionBox(Vector2 start, Vector2 end, bool visible)
    {
        _dragBox = visible ? new Rect2(start, end - start).Abs() : null;
        _root.QueueRedraw();
    }
    private static readonly Color Ink = new("d9dfd0"), Muted = new("939f95"), Amber = new("d3b276");
    private void Emit(string verb, string key = "") => Command?.Invoke(verb, key);
    private static string Str(JsonElement e, string key, string fallback = "") => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(key, out var v) ? v.ValueKind == JsonValueKind.String ? v.GetString() ?? fallback : v.ToString() : fallback;
    private static double Num(JsonElement e, string key, double fallback = 0) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(key, out var v) && v.TryGetDouble(out var d) ? d : fallback;
    private static JsonElement Get(JsonElement e, string key) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(key, out var v) ? v : default;
    private static StyleBoxFlat Style(string fill, string border, int padding = 10)
    {
        return new StyleBoxFlat { BgColor = new Color(fill), BorderColor = new Color(border), BorderWidthBottom = 1, BorderWidthTop = 1, BorderWidthLeft = 1, BorderWidthRight = 1, CornerRadiusTopLeft = 4, CornerRadiusTopRight = 4, CornerRadiusBottomLeft = 4, CornerRadiusBottomRight = 4, ContentMarginLeft = padding, ContentMarginRight = padding, ContentMarginTop = padding, ContentMarginBottom = padding };
    }
    private static Label Text(string value, int size = 14, Color? color = null)
    {
        var l = new Label { Text = value, MouseFilter = Control.MouseFilterEnum.Ignore };
        l.AddThemeFontSizeOverride("font_size", size);
        l.AddThemeColorOverride("font_color", color ?? Ink);
        return l;
    }
    private Button Button(string label, Action action, string hint = "")
    {
        var b = new Button { Text = label, TooltipText = hint, MouseDefaultCursorShape = Control.CursorShape.PointingHand, FocusMode = Control.FocusModeEnum.None, CustomMinimumSize = new Vector2(0, 30) };
        b.Pressed += action;
        return b;
    }
    private PanelContainer Panel(Control parent, float left, float top, float right, float bottom, Vector4 offsets)
    {
        var p = new PanelContainer { AnchorLeft = left, AnchorTop = top, AnchorRight = right, AnchorBottom = bottom, OffsetLeft = offsets.X, OffsetTop = offsets.Y, OffsetRight = offsets.Z, OffsetBottom = offsets.W, MouseFilter = Control.MouseFilterEnum.Stop };
        p.AddThemeStyleboxOverride("panel", Style("17201deF", "3c4940"));
        parent.AddChild(p);
        return p;
    }
    public override void _Ready()
    {
        Layer = 10;
        _root = new Control { Name = "NativeHUD", MouseFilter = Control.MouseFilterEnum.Ignore };
        _root.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.FullRect);
        AddChild(_root);
        _root.Draw += () => { if (_dragBox is Rect2 box) { _root.DrawRect(box, new Color(.55f, .75f, .65f, .12f)); _root.DrawRect(box, new Color("a2c3a3"), false, 1.5f); } };
        var theme = new Theme();
        theme.DefaultFontSize = 14;
        theme.SetColor("font_color", "Label", Ink);
        theme.SetColor("font_color", "Button", Ink);
        theme.SetStylebox("normal", "Button", Style("26332c", "465347", 7));
        theme.SetStylebox("hover", "Button", Style("3d4c3b", "a38e62", 7));
        theme.SetStylebox("pressed", "Button", Style("4b5138", "d3b276", 7));
        theme.SetStylebox("disabled", "Button", Style("202822", "303b32", 7));
        theme.SetColor("font_disabled_color", "Button", new Color("606e62"));
        _root.Theme = theme;
        var top = Panel(_root, 0, 0, 1, 0, new(12, 10, -12, 67));
        var topRow = new HBoxContainer { Alignment = BoxContainer.AlignmentMode.Begin };
        topRow.AddThemeConstantOverride("separation", 17);
        top.AddChild(topRow);
        topRow.AddChild(Text("НЕБЕСНЫЙ РУБЕЖ", 17, Amber));
        _resources = Text("Связь с симуляцией…", 13);
        _resources.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
        topRow.AddChild(_resources);
        _clock = Text("18:30", 13, Muted);
        topRow.AddChild(_clock);
        topRow.AddChild(Button("Ⅱ", () => Emit("pause"), "Пауза"));
        topRow.AddChild(Button("База", () => Emit("focus", "own")));
        topRow.AddChild(Button("Фронт", () => Emit("focus", "enemy")));
        topRow.AddChild(Button("Меню", () => Emit("menu")));
        var selected = Panel(_root, 1, 0, 1, 0, new(-292, 79, -12, 367));
        _selectionPanel = selected;
        selected.Visible = false;
        var selectionBox = new VBoxContainer();
        selectionBox.AddThemeConstantOverride("separation", 7);
        selected.AddChild(selectionBox);
        selectionBox.AddChild(Text("ПРИКАЗЫ И ВЫБРАННЫЙ ОБЪЕКТ", 11, Amber));
        _selection = Text("Штаб командования", 18);
        selectionBox.AddChild(_selection);
        _selectionInfo = Text("Выберите объект на карте", 12, Muted);
        _selectionInfo.AutowrapMode = TextServer.AutowrapMode.WordSmart;
        _selectionInfo.CustomMinimumSize = new(250, 60);
        selectionBox.AddChild(_selectionInfo);
        var actions = new GridContainer { Columns = 3 };
        selectionBox.AddChild(actions);
        foreach (var (label, verb) in new[] { ("Ремонт", "repair"), ("Улучшить", "upgrade"), ("Снести", "demolish"), ("Армия", "select-army"), ("Стоп", "stop"), ("Окоп", "dig"), ("Атака", "defense-attack"), ("Отзыв", "attack-recall") })
            actions.AddChild(Button(label, () => Emit(verb)));
        selectionBox.AddChild(Button("Автооборона", () => Emit("auto-defense"), "Передать выбранные войска автоматической обороне"));
        var bottom = Panel(_root, 0, 1, 1, 1, new(12, -190, -12, -12));
        var bottomBox = new VBoxContainer();
        bottom.AddChild(bottomBox);
        var tabs = new HBoxContainer();
        tabs.AddThemeConstantOverride("separation", 5);
        bottomBox.AddChild(tabs);
        foreach (string tab in new[] { "Город", "Промышленность", "Оборона", "Армия", "Арсенал", "Флот" })
        {
            var value = tab;
            tabs.AddChild(Button(tab, () => { _tab = value; RenderCatalog(); }));
        }
        tabs.AddChild(Button("Дорога", () => Emit("road")));
        var amount = new HBoxContainer();
        amount.AddChild(Text("  Количество", 12, Muted));
        _count = new SpinBox { MinValue = 1, MaxValue = 100, Step = 1, Value = 1, CustomMinimumSize = new(92, 30) };
        amount.AddChild(_count);
        tabs.AddChild(amount);
        var scroll = new ScrollContainer { HorizontalScrollMode = ScrollContainer.ScrollMode.Auto, VerticalScrollMode = ScrollContainer.ScrollMode.Disabled, SizeFlagsVertical = Control.SizeFlags.ExpandFill };
        bottomBox.AddChild(scroll);
        _catalogRow = new HBoxContainer();
        _catalogRow.AddThemeConstantOverride("separation", 8);
        scroll.AddChild(_catalogRow);
        _tool = Text("ЛКМ — выбор · ПКМ — приказ · WASD — камера · колесо — масштаб", 12, Muted);
        _tool.AnchorTop = 1;
        _tool.AnchorBottom = 1;
        _tool.OffsetLeft = 20;
        _tool.OffsetTop = -216;
        _tool.OffsetRight = 950;
        _tool.OffsetBottom = -193;
        _root.AddChild(_tool);
        _status = Text("", 13, Amber);
        _status.OffsetLeft = 22;
        _status.OffsetTop = 81;
        _status.OffsetRight = 820;
        _status.OffsetBottom = 110;
        _root.AddChild(_status);
        BuildMenu();
        RenderCatalog();
    }
    private void BuildMenu()
    {
        var shade = new ColorRect { Color = new Color(0.035f, .06f, .052f, .87f), MouseFilter = Control.MouseFilterEnum.Stop };
        shade.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.FullRect);
        _root.AddChild(shade);
        _menu = shade;
        var center = new CenterContainer();
        center.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.FullRect);
        shade.AddChild(center);
        var panel = new PanelContainer { CustomMinimumSize = new(520, 0) };
        panel.AddThemeStyleboxOverride("panel", Style("17201d", "596149", 30));
        center.AddChild(panel);
        var v = new VBoxContainer();
        v.AddThemeConstantOverride("separation", 13);
        panel.AddChild(v);
        v.AddChild(Text("NATIVE  /  WINDOWS  /  v0.1", 12, Amber));
        v.AddChild(Text("НЕБЕСНЫЙ\nРУБЕЖ", 39));
        v.AddChild(Text("Стройте город. Снабжайте войска. Удерживайте фронт.", 14, Muted));
        v.AddChild(Text("Правила 8.16 · Godot 3D · локальная симуляция", 12, Muted));
        foreach (var (label, mode) in new[] { ("НОВАЯ ОПЕРАЦИЯ  ·  один против одного", "solo"), ("ОБОРОНА ГОРОДА  ·  против двух армий", "siege") })
        {
            var b = Button(label, () => { Emit("new", mode); ShowMenu(false); });
            b.Disabled = !_ready;
            v.AddChild(b);
            _startButtons.Add(b);
        }
        var row = new HBoxContainer();
        v.AddChild(row);
        foreach (var (label, verb) in new[] { ("Сохранить", "save"), ("Загрузить", "load"), ("Звук", "sound") })
            row.AddChild(Button(label, () => Emit(verb)));
        var resume = Button("Вернуться на карту", () => Emit("resume"));
        v.AddChild(resume);
        v.AddChild(Text("WASD — камера   /   Shift — быстрее   /   Esc — отмена", 12, Muted));
    }
    public void ShowMenu(bool show)
    {
        if (_menu != null)
            _menu.Visible = show;
    }
    public void ShowCategory(string category)
    {
        _tab = category.ToLowerInvariant() switch
        {
            "e" or "arsenal" or "арсенал" => "Арсенал",
            "f" or "army" or "армия" => "Армия",
            "city" or "город" => "Город",
            "industry" or "промышленность" => "Промышленность",
            "defence" or "defense" or "оборона" => "Оборона",
            "naval" or "флот" => "Флот",
            _ => category
        };
        if (_catalogRow != null)
            RenderCatalog();
    }
    public void SetReady(bool ready)
    {
        _ready = ready;
        foreach (var b in _startButtons)
            b.Disabled = !ready;
        if (ready)
            ShowMessage("Симуляция готова. Выберите операцию.");
    }
    public void ShowMessage(string text, bool error = false)
    {
        if (_status == null)
            return;
        _status.Text = text;
        _status.AddThemeColorOverride("font_color", error ? new Color("e89c85") : Amber);
    }
    public void SetTool(string text)
    {
        if (_tool != null)
            _tool.Text = text;
    }
    public void SetCatalogs(JsonElement world)
    {
        var catalogs = Get(world, "catalogs");
        ReadCatalog(Get(catalogs, "buildings"), _buildings);
        ReadCatalog(Get(catalogs, "weapons"), _weapons);
        ReadCatalog(Get(catalogs, "groundUnits"), _troops);
        if (_catalogRow != null)
            RenderCatalog();
    }
    private static void ReadCatalog(JsonElement source, Dictionary<string, JsonElement> target)
    {
        target.Clear();
        if (source.ValueKind == JsonValueKind.Object)
            foreach (var p in source.EnumerateObject())
                target[p.Name] = p.Value.Clone();
    }
    private static string BuildingTab(string key) => key switch { "housing" or "market" or "service" => "Город", "electronics" or "ammofactory" or "industry" or "power" or "oilwell" or "oiltank" or "refinery" or "factory" => "Промышленность", "barracks" or "training" or "vehiclebase" => "Армия", "port" or "navalbase" or "patrolbase" or "coastgun" => "Флот", _ => "Оборона" };
    private void RenderCatalog()
    {
        _buildingPrices.Clear();
        _weaponStocks.Clear();
        foreach (var child in _catalogRow.GetChildren())
        {
            _catalogRow.RemoveChild(child);
            child.QueueFree();
        }
        if (_tab == "Армия")
        {
            var commands = new VBoxContainer { CustomMinimumSize = new(166, 98) };
            _catalogRow.AddChild(commands);
            commands.AddChild(Text("ПРИКАЗЫ АРМИИ", 11, Amber));
            var row = new HBoxContainer();
            commands.AddChild(row);
            row.AddChild(Button("Выбрать", () => Emit("select-army")));
            row.AddChild(Button("Стоп", () => Emit("stop")));
            row.AddChild(Button("Окоп", () => Emit("dig")));
            var attack = new HBoxContainer();
            commands.AddChild(attack);
            attack.AddChild(Button("Атака", () => Emit("defense-attack")));
            attack.AddChild(Button("Отозвать", () => Emit("attack-recall")));
            commands.AddChild(Button("Автооборона", () => Emit("auto-defense"), "Передать выбранные войска автоматической обороне"));
        }
        foreach (var item in _buildings)
            if (item.Key != "hq" && Get(item.Value, "retired").ValueKind != JsonValueKind.True && BuildingTab(item.Key) == _tab)
                Card(item.Key, item.Value, "build");
        if (_tab == "Армия")
            foreach (var item in _troops)
                if (Get(item.Value, "civil").ValueKind != JsonValueKind.True && Get(item.Value, "retired").ValueKind != JsonValueKind.True)
                    Card(item.Key, item.Value, "recruit");
        if (_tab == "Арсенал")
            foreach (var item in _weapons)
                Card(item.Key, item.Value, "produce");
    }
    private void Card(string key, JsonElement data, string verb)
    {
        var p = new PanelContainer { CustomMinimumSize = new(166, 98) };
        p.AddThemeStyleboxOverride("panel", Style("202b24", "3b493d", 8));
        _catalogRow.AddChild(p);
        var box = new VBoxContainer();
        box.AddThemeConstantOverride("separation", 3);
        p.AddChild(box);
        var title = Text(Str(data, "name", key), 13);
        title.CustomMinimumSize = new(150, 19);
        title.AutowrapMode = TextServer.AutowrapMode.WordSmart;
        box.AddChild(title);
        if (verb == "recruit")
        {
            title.AutowrapMode = TextServer.AutowrapMode.Off;
            title.ClipText = true;
            title.TextOverrunBehavior = TextServer.OverrunBehavior.TrimEllipsis;
            title.TooltipText = title.Text;
        }
        var price = Text(verb == "build" ? BuildingPrice(key, data) : $"{Num(data, "cost"):0} ₽   ·   {Num(data, "metal"):0} сплавы", 11, Muted);
        box.AddChild(price);
        if (verb == "build")
            _buildingPrices[key] = price;
        if (verb == "produce")
        {
            var stock = Text($"На складе: {_inventory.GetValueOrDefault(key)}", 11, Amber);
            box.AddChild(stock);
            _weaponStocks[key] = stock;
        }
        var buttons = new HBoxContainer();
        box.AddChild(buttons);
        buttons.AddChild(Button(verb == "build" ? "Построить" : verb == "recruit" ? "Нанять" : "Произвести", () => Emit(verb, key), Str(data, "description")));
        if (verb == "produce")
            buttons.AddChild(Button("Пуск", () => Emit("launch", key)));
        if (verb == "recruit")
        {
            var garrison = new HBoxContainer();
            box.AddChild(garrison);
            garrison.AddChild(Button("Гарнизон", () => Emit("army-target", key), "Поддерживать выбранное количество этого типа за ресурсы"));
            garrison.AddChild(Button("Стоп", () => Emit("army-target-stop", key), "Не пополнять этот тип войск"));
        }
    }
    public void UpdateState(JsonElement state, JsonElement selected, int selectedArmyCount)
    {
        if (_resources == null)
            return;
        var sides = Get(state, "sides");
        var own = sides.ValueKind == JsonValueKind.Array && sides.GetArrayLength() > 0 ? sides[0] : default;
        _purchaseCounts.Clear();
        var ledger = Get(Get(own, "purchases"), "building");
        if (ledger.ValueKind == JsonValueKind.Object)
            foreach (var entry in ledger.EnumerateObject())
                if (entry.Value.TryGetInt32(out int value))
                    _purchaseCounts[entry.Name] = value;
        // Match the original rules' fallback for saves predating the lifetime ledger.
        var existing = Get(state, "buildings");
        if (existing.ValueKind == JsonValueKind.Array)
        {
            var fallback = new Dictionary<string, int>();
            foreach (var building in existing.EnumerateArray())
                if (Num(building, "side") == 0 && Get(building, "settlementSlot").ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
                {
                    string buildingKey = Str(building, "key");
                    fallback[buildingKey] = fallback.GetValueOrDefault(buildingKey) + 1;
                }
            foreach (var item in fallback)
                if (!_purchaseCounts.ContainsKey(item.Key))
                    _purchaseCounts[item.Key] = item.Value;
        }
        foreach (var item in _buildingPrices)
            if (_buildings.TryGetValue(item.Key, out var definition))
                item.Value.Text = BuildingPrice(item.Key, definition);
        _inventory.Clear();
        var inventory = Get(own, "inventory");
        if (inventory.ValueKind == JsonValueKind.Object)
            foreach (var entry in inventory.EnumerateObject())
                if (entry.Value.ValueKind == JsonValueKind.Number && entry.Value.TryGetInt32(out int quantity))
                    _inventory[entry.Name] = quantity;
        if (existing.ValueKind == JsonValueKind.Array)
            foreach (var building in existing.EnumerateArray())
            {
                if (Num(building, "side") != 0 || Num(building, "hp") <= 0 || Get(building, "demolished").ValueKind == JsonValueKind.True)
                    continue;
                var store = Get(building, "launchStore");
                if (store.ValueKind != JsonValueKind.Object)
                    continue;
                foreach (var entry in store.EnumerateObject())
                    if (entry.Value.TryGetInt32(out int quantity))
                        _inventory[entry.Name] = _inventory.GetValueOrDefault(entry.Name) + quantity;
            }
        foreach (var item in _weaponStocks)
            item.Value.Text = $"На складе: {_inventory.GetValueOrDefault(item.Key)}";
        var economy = Get(state, "economy");
        double net = Num(economy, "net") * 60;
        _resources.Text = $"{Num(own, "credits"):N0} ₽    {Num(own, "materials"):N0} сплавы    {Num(own, "oil"):N0} нефть    {Num(own, "components"):N0} электроника\n" +
            $"Баланс {net:+0;-0;0} ₽/мин   ·   Сплавы +{Num(economy, "materials") * 60:0}/мин   ·   Энергия {Num(economy, "power"):0}/{Num(economy, "demand"):0}   ({Num(economy, "supply", 1) * 100:0}%)";
        double hour = (18.5 + Num(state, "time") / 50) % 24;
        int minutes = (int)Math.Floor(hour * 60);
        _clock.Text = $"{minutes / 60:00}:{minutes % 60:00}" + (Get(state, "paused").ValueKind == JsonValueKind.True ? "  ПАУЗА" : "");
        string key = Str(selected, "key");
        string name = Str(selected, "name", key);
        if (_buildings.TryGetValue(key, out var info) || _troops.TryGetValue(key, out info))
            name = Str(info, "name", name);
        _selectionPanel.Visible = selectedArmyCount > 0 || key.Length > 0;
        _selection.Text = selectedArmyCount > 0 ? $"Отряд · {selectedArmyCount}" : name.Length > 0 ? name : "Штаб командования";
        _selectionInfo.Text = key.Length > 0 ? SelectedInfo(state, selected) : selectedArmyCount > 0 ? "ПКМ по земле — движение. ПКМ по противнику — атака." : "Выберите здание или войска на карте.\nСтройте через каталог внизу.";
    }
    private static string SelectedInfo(JsonElement state, JsonElement selected)
    {
        int side = (int)Num(selected, "side", -1);
        bool own = side == 0;
        bool ally = side == 2 && Str(state, "mode") == "coop";
        string owner = own ? "Ваш объект" : ally ? "Союзный объект" : side < 0 ? "Нейтральный объект" : "Противник";
        string level = Get(selected, "level").ValueKind == JsonValueKind.Number ? $" · Ур. {Num(selected, "level"):0}" : "";
        double hp = Num(selected, "hp"), maxHp = Num(selected, "maxHp");
        string health = maxHp > 0 ? $"HP {hp:0}/{maxHp:0}" : $"HP {hp:0}";
        double progress = Num(selected, "progress", 1);
        if (progress < 1)
            health += $" · Стройка {Math.Clamp(progress, 0, 1) * 100:0}%";
        string result = owner + level + "\n" + health;
        string ammo = "";
        if (Get(selected, "ammo").ValueKind == JsonValueKind.Number)
            ammo = $"Боезапас {Num(selected, "ammo"):0}";
        if (Get(selected, "groundAmmo").ValueKind == JsonValueKind.Number)
            ammo += (ammo.Length > 0 ? " · " : "") + $"Наземный {Num(selected, "groundAmmo"):0}";
        if (ammo.Length > 0)
            result += "\n" + ammo;
        if (own)
        {
            var store = Get(selected, "launchStore");
            var queue = Get(selected, "queue");
            string storage = "";
            if (store.ValueKind == JsonValueKind.Object)
            {
                double total = 0;
                foreach (var p in store.EnumerateObject())
                    if (p.Value.ValueKind == JsonValueKind.Number && p.Value.TryGetDouble(out var amount))
                        total += amount;
                storage = $"На складе {total:0}";
            }
            if (queue.ValueKind == JsonValueKind.Array)
                storage += (storage.Length > 0 ? " · " : "") + $"Очередь {queue.GetArrayLength()}";
            if (storage.Length > 0)
                result += "\n" + storage;
        }
        return result;
    }
    private string BuildingPrice(string key, JsonElement data)
    {
        double factor = Math.Min(1.5, .5 + .25 * _purchaseCounts.GetValueOrDefault(key));
        double cost = Math.Floor(Num(data, "cost") * factor + .5), metal = Math.Floor(Num(data, "metal") * factor + .5);
        return $"{cost:0} ₽   ·   {metal:0} сплавы";
    }
}
