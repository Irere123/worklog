variable "WORKLOG_RELEASE" {
  default = ""
}

variable "WRITE_CACHE" {
  default = false
}

group "default" {
  targets = ["api", "worker", "web"]
}

target "backend" {
  context    = "."
  dockerfile = "apps/api/Dockerfile"
  args = {
    WORKLOG_RELEASE = WORKLOG_RELEASE
  }
  cache-from = ["type=gha,scope=api"]
  cache-to   = WRITE_CACHE ? ["type=gha,scope=api,mode=max"] : []
}

target "api" {
  inherits = ["backend"]
  target   = "api"
  tags     = ["worklog-api:ci"]
}

target "worker" {
  inherits = ["backend"]
  target   = "worker"
  tags     = ["worklog-worker:ci"]
  cache-to = []
}

target "web" {
  context    = "."
  dockerfile = "apps/web/Dockerfile"
  target     = "web"
  tags       = ["worklog-web:ci"]
  cache-from = ["type=gha,scope=web"]
  cache-to   = WRITE_CACHE ? ["type=gha,scope=web,mode=max"] : []
}
