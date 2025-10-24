build of app.pflow.dev - no wallet connector - minimal build/viewer

```
 pflow.svg?m=PetriNet&v=v0&p=place0&o=0&i=1&c=3&x=130&y=207&p=place1&o=1&i=0&c=0&x=395&y=299&t=txn0&x=46&y=116&t=txn1&x=227&y=112&t=txn2&x=43&y=307&t=txn3&x=235&y=306&s=txn0&e=place0&w=1&s=place0&e=txn1&w=3&s=txn2&e=place0&w=3&n=1&s=place0&e=txn3&w=1&n=1&s=txn3&e=place1&w=1
```

WIP
---
- [ ] NEW-STACK: Build viewer -> HTML -> Json+LD -> Canvas (interactive view) + SVG (static export)
- [ ] fix inhibitor usage in sims + add visualization for inhibitors
- [ ] add - share/save permalink button + auto-update URL on edits
- [ ] add id element w/ some consistent hash / IPFS signature - for verifiable models

DONE
----


BACKLOG
-------
- [ ] complete upgrades for colored tokens
- [ ] check backward-compatible support for URL formats - adopt a toURL / fromURL pattern
- [ ] test server side rendering of svg images embeddable in markdown
- [ ] add json editor back in - possibly as a toggle view
- [ ] add @id property derived from IPFS hash of model (for verifiable models)
- [ ] implement basic wallet connection for signing models
- [ ] add export to solidity smart contract
- [ ] add export to julia code
 
ICEBOX
------
- [ ] implement pan and zoom for canvas
- [ ] add new sqlite storage for server (and/or postgres?)
- [ ] test svg image generation on dark mode
- [ ] consider adopting https://github.com/microsoft/monaco-editor/tree/main for multi-language support
- [ ] petri-view.js could support multiple configurations - viewer vs editor vs banner vs thumbnail
