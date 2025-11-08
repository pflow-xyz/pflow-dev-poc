# pflow-dev-poc

While pflow.xyz/editor is a great tool for creating and editing pflow files,
it has evolved into a very complex react app.

The intention here is to re-think the viewing and sharing experience,
and extract some of the features from pflow.dev.

*Status* : Deprecated - replaced by pflow.xyz rebuild

## Goals

* allow for an infinite canvas viewing experience
  * scaling of diagrams is not mobile friendly
* support colored tokens i.e. multiple token types
  * currently pflow.xyz only supports a single token type
* improve rendering to better support large models
  * current react app makes browser lag when loading sudoku (large model)
* build in better import/export tools
  * export to gno.land
  * export to solidity
  * export to js/ts
  * export to python
* support analysis
  * export to julia (jupyter notebook)

## Test model with shortURL v1

```
https://pflow-app.fly.dev/?m=PetriNet&v=v1&p=place0&o=0&i=1&c=3&x=130&y=207&t=txn0&x=46&y=116&t=txn1&x=227&y=112&t=txn2&x=43&y=307&t=txn3&x=235&y=306&s=txn0&e=place0&w=1&s=place0&e=txn1&w=3&s=txn2&e=place0&w=3&n=1&s=place0&e=txn3&w=1&n=1
```

[launch fly.dev instance](https://pflow-app.fly.dev/?m=PetriNet&v=v1&p=place0&o=0&i=1&c=3&x=130&y=207&t=txn0&x=46&y=116&t=txn1&x=227&y=112&t=txn2&x=43&y=307&t=txn3&x=235&y=306&s=txn0&e=place0&w=1&s=place0&e=txn1&w=3&s=txn2&e=place0&w=3&n=1&s=place0&e=txn3&w=1&n=1)
