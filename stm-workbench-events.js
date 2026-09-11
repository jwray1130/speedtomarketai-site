(function(){
const handlers={};
for(const el of document.querySelectorAll("[data-stm-static]")){const entries=handlers[el.dataset.stmStatic];if(!entries)throw new Error("Unknown static event binding");for(const [name,fn] of entries)el[name]=fn;}
})();
