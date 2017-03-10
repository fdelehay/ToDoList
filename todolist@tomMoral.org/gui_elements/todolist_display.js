
const Meta = imports.gi.Meta;
const Main = imports.ui.main;
const St = imports.gi.St;
const Gtk = imports.gi.Gtk;
const GLib = imports.gi.GLib;
const Lang = imports.lang;
const Gio = imports.gi.Gio;
const Shell = imports.gi.Shell;
const PanelMenu = imports.ui.panelMenu;
const PopupMenu = imports.ui.popupMenu;
const Clutter = imports.gi.Clutter;


const Extension = imports.misc.extensionUtils.getCurrentExtension();
const section_item = Extension.imports.gui_elements.section_item;
const ExtensionSettings = Extension.imports.utils.getSettings();
const debug = Extension.imports.utils.debug;


const Gettext = imports.gettext.domain('todolist');
const _ = Gettext.gettext;


const MAX_LENGTH = 100;
const KEY_RETURN = 65293;
const KEY_ENTER  = 65421;
const BASE_JSON = '{"0": {"id": "0", "name": "Section1", "tasks": []}}';

// TodoList object
function TodoList(metadata)
{
    this.meta = metadata;
    this.n_tasks = 0;
    this._init();
}

TodoList.prototype = {
    __proto__: PanelMenu.Button.prototype,

    _init : function(){
        // Tasks file
        this.dirPath = GLib.get_home_dir() + "/.config/ToDoList/";
        if(! GLib.file_test(this.dirPath, GLib.FileTest.EXISTS)){
            GLib.mkdir_with_parents(this.dirPath, 511);
        }
        this.sectionsFile =  this.dirPath + "section.tasks";
        this.dbFile =  this.dirPath + "tasks.json";
        this._load();

        // Button ui
        PanelMenu.Button.prototype._init.call(this, St.Align.START);
        this.mainBox = null;
        this.buttonText = new St.Label({text:_("(...)"), y_align: Clutter.ActorAlign.CENTER});
        this.buttonText.set_style("text-align:center;");
        this.actor.add_actor(this.buttonText);

        this._buildUI();
        this._fill_ui();

        // Key binding
        let mode = Shell.ActionMode ? Shell.ActionMode.ALL : Shell.KeyBindingMode.ALL;
        Main.wm.addKeybinding('open-todolist',
                              ExtensionSettings,
                              Meta.KeyBindingFlags.NONE,
                              mode,
                              Lang.bind(this, this.signalKeyOpen));
    },
    _buildUI: function(){
        // Destroy previous box         
        if (this.mainBox != null)
            this.mainBox.destroy();


        // Create main box
        this.mainBox = new St.BoxLayout();
        this.mainBox.set_vertical(true);

        // Create todos box
        let todosSec = new PopupMenu.PopupMenuSection('todosBox');
        todosSec.one = false
        // Call back to ensure only one section is open
        todosSec._setOpenedSubMenu = function(subMenu){
            if(todosSec.one)
                return;
            todosSec.one = true;

            for each (var item in todosSec._getMenuItems()){
                item.menu.close();
            }
            if(subMenu != null)
                subMenu.open();
            todosSec.one = false;
        }
        this.todosSec = todosSec;

        // Create todos scrollview
        var scrollView = new St.ScrollView({style_class: 'vfade',
            hscrollbar_policy: Gtk.PolicyType.NEVER,
            vscrollbar_policy: Gtk.PolicyType.AUTOMATIC});
        scrollView.add_actor(this.todosSec.actor);
        this.mainBox.add_actor(scrollView);

        // Separator
        var separator = new PopupMenu.PopupSeparatorMenuItem();
        this.mainBox.add_actor(separator.actor);

        // Text entry
        this.newTask = new St.Entry({
            name: "newSectionEntry",
            hint_text: _("New Section..."),
            track_hover: true,
            can_focus: true
        });
        let entryNewTask = this.newTask.clutter_text;
        entryNewTask.set_max_length(MAX_LENGTH);
        // Call back to add section when ENTER is press
        entryNewTask.connect('key-press-event', Lang.bind(this,function(o,e)
        {
            let symbol = e.get_key_symbol();
            if (symbol == KEY_RETURN || symbol == KEY_ENTER)
            {
                this._create_section(o.get_text());
                entryNewTask.set_text('');
            }
        }));

        // Bottom section
        var bottomSection = new PopupMenu.PopupMenuSection();
        bottomSection.actor.add_actor(this.newTask);
        bottomSection.actor.add_style_class_name("newTaskSection");
        this.mainBox.add_actor(bottomSection.actor);
        this.menu.box.add(this.mainBox);
    },

    // Fill UI with the section items
    _fill_ui : function(){

        debug("Fill UI");
        
        // Check if tasks file exists
        this._clear();
        this.n_tasks = 0;

        for(var id in this.sections)
            this._add_section(this.sections[id]);
        this._set_text();


        // Restore hint text
        this.newTask.hint_text = _("New task...");

    },
    _add_section: function(section){
        let item = new section_item.SectionItem(section);
        this.todosSec.addMenuItem(item);

        this.n_tasks += item.n_tasks;

        item.connect('dump_signal', Lang.bind(this, this._dump));
        item.connect('supr_signal', Lang.bind(this, this._remove_section));
        item.connect('task_count_changed', Lang.bind(this, this._update_counter));
    },
    _update_counter: function(item, diff)
    {
        this.n_tasks -= diff;
        this._set_text();
    },
    _set_text: function(){
        // Update status button
        this.buttonText.set_text("ToDo ("+this.n_tasks+")");
    },
    _clear : function(){
        for each (var section in this.todosSec.menu){
            section._clear();
            section._terminate();
        }
        this.todosSec.removeAll();
    },
    _create_section : function(text){
        // Don't add empty task
        if (text == '' || text == '\n')
            return;

        // Add the new section to the sections dictionary
        let id = this.next_id;
        let section = {
            "id": id,
            "name": text,
            "tasks": []
        };

        this.sections[id] = section;
        this.next_id += 1;
        this._dump();

        // Add the section to the UI
        this._add_section(section);

    },

    // Remove section 'text' from the section file
    _remove_section : function(o, section){
        // Remove the section from the internal db and 
        // synchronize it with the permanent JSON file
        delete this.sections[section.id];
        this._dump();

        // clean-up the section
        section.destroy();
    },
    _dump: function(){
        // Open dbFile and dump our JSON todolist
        let f = Gio.file_new_for_path(this.dbFile);
        let out = f.replace(null, false, Gio.FileCreateFlags.NONE, null);
        Shell.write_string_to_stream(out, JSON.stringify(this.sections));
        out.close(null);
    },
    _load: function(){
        // Check if the dbFile exists. If not, create a basic one
        if (!GLib.file_test(this.dbFile, GLib.FileTest.EXISTS))
            GLib.file_set_contents(this.dbFile, BASE_JSON);

        // Load the content of the file and parse it with JSON.
        let content = Shell.get_file_contents_utf8_sync(this.dbFile);
        this.sections = JSON.parse(content);

        // compute the next id to avoid collapse in our the todolist
        this.next_id = 0;
        for (var id in this.sections){
            this.next_id = Math.max(this.next_id, id);
        }
        this.next_id ++;
    },
    _enable : function() {
        // Conect file 'changed' signal to _refresh
        // let fileM = Gio.file_new_for_path(this.dbFile);
        // this.monitor = fileM.monitor(Gio.FileMonitorFlags.NONE, null);
        // this.monitor.connect('changed', Lang.bind(this, this._fill_ui));

    },
    _disable : function() {
        // Stop monitoring file
        this._clear();
        Main.wm.removeKeybinding('open-todolist');
        debug('clean up for todolist done');
    },
    // Called when 'open-todolist' is emitted (binded with Lang.bind)
    signalKeyOpen: function(){
        if (this.menu.isOpen)
            this.menu.close();
        else{
            this.menu.open();
            this.newTask.grab_key_focus();
        }
    },
    _onOpenStateChanged: function(state, s){
        if(s)
            for each (var item in this.todosSec._getMenuItems())
                item.menu.close();
    }


}