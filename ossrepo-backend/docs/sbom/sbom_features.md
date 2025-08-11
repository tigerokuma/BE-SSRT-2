# Features Documentation

## Base Route: `/sbom`

---

### 1. **GET `/sbom/dep-list/:user_id`**

**Description:**  
Retrieve a list of watchlist IDs and package names the user is following.

**URL Parameters:**  
- `user_id` (string, required): ID of the user.

**Response:**  
```json
[
  {
    "watchlist_id": "string",
    "package_name": "string"
  }
]
```

**Errors:**  
- 400 Bad Request if `user_id` missing  
- 502 Bad Gateway if retrieval fails

---

### 2. **GET `/sbom/watchlist-metadata/:watchlist_id`**

**Description:**  
Get metadata summary of a specific watchlist's SBOM.

**URL Parameters:**  
- `watchlist_id` (string, required): ID of the watchlist.

**Response:**  
```json
{
  "sbomPackage": "string",
  "directDependencies": number,
  "transitiveDependencies": number,
  "licenseSummary": {
      "id": "string",
      "count": number,
      "link": "string",
      "category": "string"
    },
    {
      "id": "string",
      "count": number,
      "link": "string",
      "category": "string"
    }
}
```

---

### 3. **GET `/sbom/user-watchlist-metadata/:user_id`**

**Description:**  
Get metadata summary of the user’s personal SBOM.

**URL Parameters:**  
- `user_id` (string, required): ID of the user.

**Response:**  
Same shape as `/watchlist-metadata`.

---

### 4. **GET `/sbom/graph-dependencies/:watchlist_id/:node_id`**

**Description:**  
Retrieve dependency graph data for a node in a watchlist SBOM.

**URL Parameters:**  
- `watchlist_id` (string, required)  
- `node_id` (string, required)

**Query Parameters:**  
- `vulns` (string, optional): Comma-separated list of vulnerable package IDs.

**Response:**  
```json
{
  "nodes": [{ "id": "string", "color": "grey|lightblue|red" }],
  "links": [{ "source": "string", "target": "string" }]
}
```

---

### 5. **GET `/sbom/user-graph-dependencies/:user_id/:node_id`**

**Description:**  
Retrieve dependency graph data for a node in the user’s SBOM.

Parameters and response match `/graph-dependencies`.

---

### 6. **GET `/sbom/search/:watchlist_id/:search`**

**Description:**  
Search for nodes in a watchlist SBOM matching the search term.

**URL Parameters:**  
- `watchlist_id` (string, required)  
- `search` (string, required)

**Response:**  
```json
[
  {
    "node": {
      "id": "string",
      "name": "string",
      "dependsOn": ["string"]
    }
  }
]
```

---

### 7. **GET `/sbom/user-search/:user_id/:search`**

**Description:**  
Search for nodes in the user’s SBOM.

Parameters and response match `/search/:watchlist_id/:search`.

---

### 8. **GET `/sbom/watchlist/:watchlist_id`**

**Description:**  
Get the raw SBOM JSON for a specific watchlist.

**Response:**  
Returns the SBOM object.

---

### 9. **GET `/sbom/user-watchlist/:user_id`**

**Description:**  
Get the raw SBOM JSON for a user.

---

### 10. **POST `/sbom/generate-SBOM/:watchlist_id`**

**Description:**  
Generate a new SBOM for the given watchlist by cloning its repository, running `cdxgen`, and saving results.

**Response:**  
Returns generated SBOM JSON.

---

### 11. **POST `/sbom/merge-SBOM/:user_id`**

**Description:**  
Merge all SBOMs from watchlists a user follows into a single combined SBOM.

**Response:**  
Returns merged SBOM JSON.

---

# DTOs Summary

| DTO Name          | Fields                                   | Validation               |
|-------------------|------------------------------------------|--------------------------|
| `CreateSbomDto`   | `id: string`, `sbom: any`                 | `id` required string     |
| `UpdateSbomDto`   | `id: string`, `sbom: any`, `updated_at: Date` | `id` string, `updated_at` date |
| `GraphParamsDto`  | `id: string`, `node_id: string`           | Both required strings    |
| `SearchParamsDto` | `id: string`, `search: string`            | Both required strings    |

---

# Service Behavior Summary

## SbomBuilderService
- **cloneRepo(gitUrl)**: Clones repository into temporary folder.  
- **cleanupRepo(repoPath)**: Removes `test`/`tests` folders.  
- **runCommand(...)**: Runs a Docker container with given command and volume mounts.  
- **genSbom(repoPath)**: Generates SBOM using `cdxgen` inside Docker. Retries with `--no-recurse` if needed, falls back to empty SBOM on failure.  
- **addSbom(watchlistId)**: Clones repo, cleans, generates SBOM, stores in DB.  
- **writeSbomsToTempFiles(sboms)**: Writes multiple SBOMs to temp directory.  
- **mergeSbom(user_id)**: Merges all followed SBOMs into one using `cyclonedx-cli merge`, updates metadata, stores in DB.

## SbomQueryService
- **getWatchSbom(user_id)**: Fetches watchlist SBOM.  
- **getUserSbom(user_id)**: Fetches user SBOM.  
- **getWatchMetadataSbom(sbom)**: Returns summary stats: package ref, direct/transitive deps, license counts.  
- **getNodeDeps(sbomText, node_id, vulns)**: Returns graph nodes/links for dependencies of a node, marking vulnerabilities.  
- **searchNodeDeps(sbomText, search)**: Finds nodes whose ref/name match search.  
- **getDepList(user_id)**: Lists watchlists and package names followed by a user.

## SbomRepository
- **upsertWatchSbom(data)**: Inserts or updates watchlist SBOM.  
- **upsertUserSbom(data)**: Inserts or updates user SBOM.  
- **getUrl(id)**: Retrieves repository URL from watchlist/package IDs.  
- **getWatchSbom(id)**: Retrieves SBOM for watchlist.  
- **getUserSbom(id)**: Retrieves SBOM for user.  
- **getFollowSboms(user_id)**: Retrieves SBOMs for all watchlists a user follows.  
- **getWatchFollows(user_id)**: Retrieves list of watchlists and package names followed by a user.