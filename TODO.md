build of app.pflow.dev - no wallet connector - minimal build/viewer

```
 pflow.svg?m=PetriNet&v=v0&p=place0&o=0&i=1&c=3&x=130&y=207&p=place1&o=1&i=0&c=0&x=395&y=299&t=txn0&x=46&y=116&t=txn1&x=227&y=112&t=txn2&x=43&y=307&t=txn3&x=235&y=306&s=txn0&e=place0&w=1&s=place0&e=txn1&w=3&s=txn2&e=place0&w=3&n=1&s=place0&e=txn3&w=1&n=1&s=txn3&e=place1&w=1
```

WIP
---
- [ ] refactor to use canvas elements
- [ ] refine SVG + editor commands
- [ ] rebuild w/ 1st class json+ld support
- [ ] all edited object add permalinks
- [ ] add - save permalink button



BACKLOG
-------
- [ ] gno.land version needs multi-token support
- [ ] url-visualizer on gno.land to build out multi-step actions
- [ ] fix token colors - changing colors in the editor should change the diagram
- [ ] fix capacity set to 0 does not remove capacity limitation
- [ ] test that permalink gets updated on edit
- [ ] minURL - add support for multi-token colors
- [ ] fix docker build to work w/ tests in place

 
  DONE
----
- [x] fix editor interactions - issue selecting text and last few lines of code
- [x] in this project use ./static/form.html and ./static/model.svg as template
- [x] Review roadmap.md - consider deploying gnoland-only version first

ICEBOX
------
- [ ] fix failing tests
- [ ] complete upgrades for colored tokens
- [ ] check backward-compatible support for URL formats
- [ ] consider adopting https://github.com/microsoft/monaco-editor/tree/main for multi-language support
- [ ] review the plan to implement custom lexer/parser for go, julia, solidity, python
```
/?foo=1&bar=1&baz=1
````
- [ ] build parser/lexer to interpret actions from URL
      where foo, bar, baz are actions and 1 is number of firings
 
- [ ] consider how to deploy indexing on AtomOne w/ https://github.com/allinbits/temporalib

- [ ] test svg image generation on dark mode
- [ ] setup svg badges - does it need? Access-Control-Allow-Origin: *

 
- [ ] Use SVG for UI elements and Canvas for complex rendering
- [ ] backport to pflow.xyz - consider how to store legacy petri-net data to make it compatible with minURL
- [ ] add new sqlite storage for server
- 
- [ ] NEW-STACK: Build viewer -> HTML -> Object -> SVG -> metadata -> CDATA (interactive svg)
- [ ] render w/ SVG only (static)

- [ ] exploring dom updates:update object.data
- [ ] vs live updates inside an embedded SVG using  postMessage().
 
