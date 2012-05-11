/**
 * Searchinfiles Module for the Cloud9 IDE
 *
 * @copyright 2010, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */

define(function(require, exports, module) {

var ide = require("core/ide");
var ext = require("core/ext");
var util = require("core/util");
var settings = require("core/settings");
var editors = require("ext/editors/editors");
var fs = require("ext/filesystem/filesystem");
var ideConsole = require("ext/console/console");
var menus = require("ext/menus/menus");
var markup = require("text!ext/searchinfiles/searchinfiles.xml");
var commands = require("ext/commands/commands");
var tooltip = require("ext/tooltip/tooltip");
var libsearch = require("ext/searchreplace/libsearch");
var searchreplace = require("ext/searchreplace/searchreplace");

var searchFilePath = ide.davPrefix + "/search_results.c9search";
var searchContentType = "c9search";

// Ace dependencies
var EditSession = require("ace/edit_session").EditSession;
var Document = require("ace/document").Document;
var ProxyDocument = require("ext/code/proxydocument");

module.exports = ext.register("ext/searchinfiles/searchinfiles", apf.extend({
    name     : "Search in files",
    dev      : "Ajax.org",
    type     : ext.GENERAL,
    alone    : true,
    offline  : false,
    replaceAll : false,
    markup   : markup,
    skin     : {
        id   : "searchinfiles"
    },
    pageTitle: "Search Results",
    pageID   : "pgSFResults",

    nodes    : [],
    
    searchPage : null,

    hook : function(){
        var _self = this;

        commands.addCommand({
            name: "searchinfiles",
            hint: "search for a string through all files in the current workspace",
            bindKey: {mac: "Shift-Command-F", win: "Ctrl-Shift-F"},
            exec: function () {
                _self.toggleDialog(1);
            }
        });

        this.nodes.push(
            menus.addItemByPath("Find/~", new apf.divider(), 10000),
            menus.addItemByPath("Find/Find in Files...", new apf.item({
                command : "searchinfiles"
            }), 20000)
        );
    },

    init : function(amlNode){
        var _self = this;
        
        ide.addEventListener("settings.load", function(e){
            e.ext.setDefaults("editors/code/filesearch", [
                ["regex", "false"],
                ["matchcase", "false"],
                ["wholeword", "false"],
                ["console", "true"]
            ]);
        });
        
        ide.addEventListener("c9searchopen", function(e){
            _self.searchPage = e.doc.$page;
        });

        ide.addEventListener("c9searchclose", function(e){
            _self.searchPage = null;
        });

        tabEditors.addEventListener("reorder", function(e) {
            _self.searchPage = e.page;
        });
        
        commands.addCommand({
            name: "hidesearchinfiles",
            bindKey: {mac: "ESC", win: "ESC"},
            isAvailable : function(editor){
                return winSearchInFiles.visible;
            },
            exec: function(env, args, request) {
                _self.toggleDialog(-1);
            }
        });
        
        ide.addEventListener("init.ext/console/console", function(e){
            mainRow.insertBefore(winSearchInFiles, e.ext.splitter);
        });
        if (winSearchInFiles.parentNode != mainRow) {
            mainRow.insertBefore(winSearchInFiles, 
                self.winDbgConsole && winDbgConsole.previousSibling || null);
        }

        winSearchInFiles.addEventListener("prop.visible", function(e) {
            if (e.value) {
                if (self.trFiles)
                    trFiles.addEventListener("afterselect", _self.setSearchSelection);
                _self.setSearchSelection();
            }
            else {
                var editor = editors.currentEditor;
                if (editor)
                    editor.focus();
        
                if (self.trFiles)
                    trFiles.removeEventListener("afterselect", 
                        this.setSearchSelection);
            }
        });
        ide.addEventListener("init.ext/tree/tree", function(){
            trFiles.addEventListener("afterselect", _self.setSearchSelection);
        });

        txtSFFind.addEventListener("keydown", function(e) {
            if (e.keyCode == 13 && !e.ctrlKey && !e.altKey && !e.metaKey) {
                _self.execFind();
                return false;
            }
            
            if (_self.findKeyboardHandler(e, "searchfiles", this, chkSFRegEx) === false)
                return false;
                
            if (chkSFRegEx.checked
              && _self.evaluateRegExp(txtSFFind, tooltipSearchInFiles, 
              winSearchInFiles, e.htmlEvent) === false) {
                return;
            }
        });
        txtSFFind.addEventListener("keyup", function(e) {
            if (e.keyCode != 8 && (e.ctrlKey || e.shiftKey || e.metaKey 
              || e.altKey || !apf.isCharacter(e.keyCode)))
                return;
            
            if (chkSFRegEx.checked) {
                _self.evaluateRegExp(
                    txtSFFind, tooltipSearchInFiles, winSearchInFiles);
            }
        });
        
        txtSFReplace.addEventListener("keydown", function(e) {
            if (e.keyCode == 13 && !e.ctrlKey && !e.altKey && !e.metaKey) {
                _self.replace();
                return false;
            }
            
            if (_self.findKeyboardHandler(e, "replacefiles", this, chkSFRegEx) === false)
                return false;
        });
        
        txtSFPatterns.addEventListener("keydown", function(e){
            if (e.keyCode == 13)
                return false;
            
            if (_self.findKeyboardHandler(e, "searchwhere", this) === false)
                return false;
        });
        
        var tt = document.body.appendChild(tooltipSearchInFiles.$ext);
        
        chkSFRegEx.addEventListener("prop.value", function(e){
            if (apf.isTrue(e.value)) {
                if (txtSFFind.getValue())
                    _self.updateInputRegExp(txtSFFind);
            }
            else
                _self.removeInputRegExp(txtSFFind);
        });
        
        var cbs = winSearchInFiles.getElementsByTagNameNS(apf.ns.aml, "checkbox");
        cbs.forEach(function(cb){
            tooltip.add(cb.$ext, {
                message : cb.label,
                width : "auto",
                timeout : 0,
                tooltip : tt,
                animate : false,
                getPosition : function(){
                    var pos = apf.getAbsolutePosition(winSearchInFiles.$ext);
                    var left = pos[0] + cb.getLeft();
                    var top = pos[1];
                    return [left, top - 16];
                }
            });
        });
    },

    setSearchSelection: function(e){
        var selectedNode;
        
        if (self.trFiles) {
            // If originating from an event
            if (e && e.selected)
                selectedNode = e.selected;
            else
                selectedNode = this.getSelectedTreeNode();
    
            var filepath = selectedNode.getAttribute("path").split("/");
    
            var name = "";
            // get selected node in tree and set it as selection
            if (selectedNode.getAttribute("type") == "folder") {
                name = filepath[filepath.length - 1];
            }
            else if (selectedNode.getAttribute("type") == "file") {
                name = filepath[filepath.length - 2];
            }
    
            if (name.length > 25) {
                name = name.substr(0, 22) + "...";
            }
        }
        else {
            var path = settings.model.queryValue("auto/tree_selection/@path");
            if (!path)
                return;
            
            var p;
            if ((name = (p = path.split("/")).pop()).indexOf(".") > -1)
                name = p.pop();
        }

        rbSFSelection.setAttribute("label", "Selection ( " + name + " )");
    },

    getSelectedTreeNode: function() {
        var node = self["trFiles"] ? trFiles.selected : fs.model.queryNode("folder[1]");
        if (!node)
            node = trFiles.xmlRoot.selectSingleNode("folder[1]");
        while (node.tagName != "folder")
            node = node.parentNode;
        return node;
    },
    
    toggleDialog: function(force, isReplace, noselect, callback) {
        var _self = this;
        
        ext.initExtension(this);

        tooltipSearchInFiles.$ext.style.display = "none";

        if (!force && !winSearchInFiles.visible || force > 0) {
            if (winSearchInFiles.visible) {
                txtSFFind.focus();
                txtSFFind.select();
                return;
            }
            
            if (searchreplace.inited && winSearchReplace.visible) {
                searchreplace.toggleDialog(-1, null, null, function(){
                    _self.toggleDialog(force, isReplace, noselect);
                });
                return;
            }
            
            winSearchInFiles.$ext.style.overflow = "hidden";
            winSearchInFiles.$ext.style.height 
                = winSearchInFiles.$ext.offsetHeight + "px";
            
            this.position = -1;

            var editor = editors.currentEditor;
            if (editor) {
                var sel   = editor.getSelection();
                var doc   = editor.getDocument();
                var range = sel.getRange();
                var value = doc.getTextRange(range);
    
                if (value) {
                    txtFind.setValue(value);
                    
                    delete txtFind.$undo;
                    delete txtFind.$redo;
                    
                    if (chkRegEx.checked)
                        this.updateInputRegExp(txtSFFind);
                }
            }

            winSearchInFiles.show();
            txtSFFind.focus();
            txtSFFind.select();
            
            winSearchInFiles.$ext.scrollTop = 0;
            document.body.scrollTop = 0;
            
            //Animate
            Firmin.animate(winSearchInFiles.$ext, {
                height: "102px",
                timingFunction: "cubic-bezier(.10, .10, .25, .90)"
            }, 0.2, function() {
                winSearchInFiles.$ext.style[apf.CSSPREFIX + "TransitionDuration"] = "";
                winSearchInFiles.$ext.style.height = "";
                
                setTimeout(function(){
                    apf.layout.forceResize();
                }, 200);
            });
        }
        else if (winSearchInFiles.visible) {
            if (txtSFFind.getValue())
                _self.saveHistory(txtSFFind.getValue());
            
            winSearchInFiles.visible = false;
            
            winSearchInFiles.$ext.style.height 
                = winSearchInFiles.$ext.offsetHeight + "px";

            //Animate
            Firmin.animate(winSearchInFiles.$ext, {
                height: "0px",
                timingFunction: "ease-in-out"
            }, 0.2, function(){
                winSearchInFiles.visible = true;
                winSearchInFiles.hide();
                
                winSearchInFiles.$ext.style[apf.CSSPREFIX + "TransitionDuration"] = "";

                if (!noselect && editors.currentEditor)
                    editors.currentEditor.ceEditor.focus();
                
                setTimeout(function(){
                    callback 
                        ? callback()
                        : apf.layout.forceResize();
                }, 50);
            });
        }

        return false;
    },

    searchinfiles: function() {
        this.toggleDialog(1);
    },

    getOptions: function() {
        var _self = this;

        return {
            query: txtSFFind.value,
            needle: txtSFFind.value,
            pattern: txtSFPatterns.value,
            casesensitive: chkSFMatchCase.checked ? "1" : "0",
            regexp: chkSFRegEx.checked ? "1" : "0",
            replaceAll: _self.replaceAll ? "true" : "false",
            replacement: txtSFReplace.value,
            wholeword: chkSFWholeWords.checked
        };
    },
    
    replace : function(){
        this.replaceAll = true;
        this.execFind();
        this.replaceAll = false;
    },

    execFind: function() {
        var _self = this;
   
        if (chkSFConsole.checked) {
            // show the console
            ideConsole.show();
            
            if (!this.$panel) {
                this.$panel = tabConsole.add(this.pageTitle, this.pageID);
                this.$panel.setAttribute("closebtn", true);
                     
                tabConsole.set(_self.pageID);
                
                this.codeEditor = this.$panel.appendChild(new apf.codeeditor({
                    syntax            : "c9search",
                    "class"           : "nocorner",
                    anchors           : "0 0 0 0",
                    theme             : "ace/theme/monokai",
                    overwrite         : "[{require('core/settings').model}::editors/code/@overwrite]",
                    folding           : "true",
                    behaviors         : "[{require('core/settings').model}::editors/code/@behaviors]",
                    selectstyle       : "[{require('core/settings').model}::editors/code/@selectstyle]",
                    activeline        : "[{require('core/settings').model}::editors/code/@activeline]",
                    gutterline        : "[{require('core/settings').model}::editors/code/@gutterline]",
                    showinvisibles    : "[{require('core/settings').model}::editors/code/@showinvisibles]",
                    showprintmargin   : "false",
                    softtabs          : "[{require('core/settings').model}::editors/code/@softtabs]",
                    tabsize           : "[{require('core/settings').model}::editors/code/@tabsize]",
                    scrollspeed       : "[{require('core/settings').model}::editors/code/@scrollspeed]",
                    newlinemode       : "[{require('core/settings').model}::editors/code/@newlinemode]",
                    animatedscroll    : "[{require('core/settings').model}::editors/code/@animatedscroll]",
                    fontsize          : "[{require('core/settings').model}::editors/code/@fontsize]",
                    gutter            : "[{require('core/settings').model}::editors/code/@gutter]",
                    highlightselectedword : "[{require('core/settings').model}::editors/code/@highlightselectedword]",
                    autohidehorscrollbar  : "[{require('core/settings').model}::editors/code/@autohidehorscrollbar]",
                    fadefoldwidgets   : "false"
                }));
                
                this.codeEditor.$editor.renderer.scroller.addEventListener("dblclick", function(e) {
                    _self.launchFileFromSearch(_self.codeEditor.$editor);
                });
                
                this.$panel.addEventListener("afterclose", function(){
                    this.removeNode();
                    return false;
                });
            }
            else {
                tabConsole.appendChild(this.$panel);
                tabConsole.set(this.pageID);
            }
        }
        
        // Determine the scope of the search
        var path;
        if (grpSFScope.value == "projects") {
            path = ide.davPrefix;
        }
        else if (!self.trFiles) {
            path = settings.model.queryValue("auto/tree_selection/@path");
            if (!path)
                return;
            
            var p;
            if ((name = (p = path.split("/")).pop()).indexOf(".") > -1)
                name = p.pop();
        }
        if (!path) {
            var node = this.getSelectedTreeNode();
            path = node.getAttribute("path");
        }

        var options = this.getOptions();
        var query = txtSFFind.value;
        options.query = query.replace(/\n/g, "\\n");

        // even if there's text in the "replace" field, don't send it when not replacing
        if (!this.replaceAll)
            options.replacement = ""; 

        // prepare new Ace document to handle search results
        var node = apf.getXml("<file />");
        node.setAttribute("name", "Search Results");
        node.setAttribute("path", searchFilePath);
        node.setAttribute("customtype", util.getContentType(searchContentType));
        node.setAttribute("changed", "1");
        node.setAttribute("newfile", "1");
        node.setAttribute("saving", "1");
        
        var doc = ide.createDocument(node);
        
        // arrange beginning message
        var messageHeader = this.messageHeader(path, options);
        
        if (chkSFConsole.checked) {
            if (_self.acedoc !== undefined && _self.acedoc.$lines !== undefined && _self.acedoc.$lines.length > 0) { // append to tab editor if it exists
                _self.appendLines(_self.codeEditor.$editor, _self.acedoc, messageHeader);
                _self.codeEditor.$editor.gotoLine(_self.acedoc.getLength());
            }
            else {
                _self.codeEditor.$editor.setSession(new EditSession(new ProxyDocument(new Document(messageHeader)), "ace/mode/c9search"));
                _self.acedoc = _self.codeEditor.$editor.session.getDocument().doc; // store a reference to the doc
            }
        }
        else {
            if (this.searchPage === null) { // the results are not open, create a new page
                doc.cachedValue = messageHeader;
                ide.dispatchEvent("openfile", {doc: doc, node: node});
            }
            else {
                this.appendLines(editors.currentEditor.amlEditor.$editor, _self.searchPage.$doc.acedoc, messageHeader);
                editors.showFile(searchFilePath);
                
               _self.searchPage = this.searchPage;
               // this.searchPage.$editor.ceEditor.$editor.gotoLine(this.searchPage.$doc.acedoc.getLength());
            } 
        }
        
        var resultingData = "";
        
        var ranOnce = false;
        var id = davProject.report(path, "codesearch", options, function(data, state, extra) {
            ranOnce = true;
            resultingData = data;
        });
        
        // Start streaming
        var timer = setInterval(function(){ 
            var q = davProject.realWebdav.queue[id];
            
            if (!chkSFConsole.checked)
                _self.appendLines(editors.currentEditor.amlEditor.$editor, _self.searchPage.$doc.acedoc, resultingData);
            else 
                _self.appendLines(_self.codeEditor.$editor, _self.acedoc, resultingData);
                
            if (ranOnce && !q) { // the end
                _self.replaceAll = false; // reset
                return clearInterval(timer);
            }
        }, 200);
        
        this.saveHistory(options.query, "searchfiles");
        this.position = 0;

        ide.dispatchEvent("track_action", {type: "searchinfiles"});
    },

    launchFileFromSearch : function(editor) {
        var session = editor.getSession();
        var currRow = editor.getCursorPosition().row;
        var path = null;
        
        if (editor.getSession().getLine(currRow).length == 0) // no text in this row
            return;
        
        var clickedLine = session.getLine(currRow).trim().split(":"); // number:text
        
        if (clickedLine.length < 2) // not a line number with text row
            return;
        
        while (currRow > 0 && session.getTokenAt(currRow, 0).type != "string") {
          currRow--;
        }
        
        path = editor.getSession().getLine(currRow);
        
        if (path.charAt(path.length - 1) == ":")
            path = path.substring(0, path.length-1);
        
        if (path !== undefined && path.length > 0)
            editors.showFile(ide.davPrefix + "/" + path, clickedLine[0], 0, clickedLine[1]);
    },

    appendLines : function(editor, doc, content) {
        var currLength = doc.getLength();
        
        var contentArray = content.split("\n");
        var contentLength = contentArray.length;
        
        if (contentLength > 0 && contentArray[contentLength - 1].indexOf("Results:") == 0) {
            var count = contentArray.pop();
            count = count.substring(count.indexOf(" ") + 1);
            
            var countJSON = JSON.parse(count);
            var finalMessage = this.messageFooter(countJSON);
        }
        
        if (content.length > 0)
            doc.insertLines(currLength, contentArray);
        
        if (countJSON !== undefined) {
            doc.insertLines(doc.getLength(), ["\n", finalMessage, "\n", "\n"]);

            if (!chkSFConsole.checked) {
                var node = this.searchPage.$doc.getNode();
                node.setAttribute("saving", "0");
                node.setAttribute("changed", "0");
            }
        }
    },
    
    messageHeader : function(path, options) {
        var optionsDesc = [];
        
        if (options.regexp === true) {
            optionsDesc.push("regexp");
        }
        if (options.casesensitive === true) {
            optionsDesc.push("case sensitive");
        }
        if (options.wholeword === true) {
            optionsDesc.push("whole word");
        }
        
        if (optionsDesc.length > 0) {
            optionsDesc = "(" + optionsDesc.join(", ") + ")";
        }
        else {
            optionsDesc = "";
        }
        
        var replacement = "";
        if (options.replacement.length > 0)
            replacement = "', replaced as '" + options.replacement ;
        
        return "Searching for '" + options.query + replacement + "' in " + path + optionsDesc + "\n";    
    },
    
    messageFooter : function(countJSON) {
        var message = "Found " + countJSON.count;
        
        message += (countJSON.count > 1 || countJSON.count > 0) ? " matches" : " match";
        
        message += " in " + countJSON.filecount;
         
        message += (countJSON.filecount > 1 || countJSON.filecount > 0) ? " files" : " file";
            
        return message;
    },
    
    
    enable : function(){
        this.nodes.each(function(item){
            item.enable();
        });
    },

    disable : function(){
        this.nodes.each(function(item){
            item.disable();
        });
    },

    destroy : function(){
        menus.remove("Find/~", 10000);
        menus.remove("Find in Files...");
        
        commands.removeCommandByName("searchinfiles");
        
        this.nodes.each(function(item){
            item.destroy(true, true);
        });
        this.nodes = [];
    }
}, libsearch));

});