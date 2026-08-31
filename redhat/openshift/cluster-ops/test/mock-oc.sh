#!/bin/bash
# Mock oc CLI for plugin testing in disposable containers.
# Install: cp mock-oc.sh /usr/local/bin/oc && chmod +x /usr/local/bin/oc

case "$*" in
  "whoami")
    echo "developer"
    ;;
  "whoami -t")
    echo "sha256~mock-token-abc123"
    ;;
  "version -o json")
    cat <<'EOF'
{"clientVersion":{"major":"4","minor":"17","gitVersion":"v4.17.0"},"serverVersion":{"major":"1","minor":"30","gitVersion":"v1.30.4+k8s"},"openshiftVersion":"4.17.3"}
EOF
    ;;
  *"get nodes"*)
    cat <<'EOF'
{"apiVersion":"v1","kind":"List","items":[{"metadata":{"name":"master-0"},"status":{"conditions":[{"type":"Ready","status":"True"}]}},{"metadata":{"name":"master-1"},"status":{"conditions":[{"type":"Ready","status":"True"}]}},{"metadata":{"name":"worker-0"},"status":{"conditions":[{"type":"Ready","status":"True"}]}}]}
EOF
    ;;
  *"get clusteroperators"*)
    cat <<'EOF'
{"apiVersion":"v1","kind":"List","items":[{"metadata":{"name":"authentication"},"status":{"conditions":[{"type":"Available","status":"True"},{"type":"Degraded","status":"False"}]}},{"metadata":{"name":"console"},"status":{"conditions":[{"type":"Available","status":"True"},{"type":"Degraded","status":"False"}]}},{"metadata":{"name":"dns"},"status":{"conditions":[{"type":"Available","status":"True"},{"type":"Degraded","status":"False"}]}},{"metadata":{"name":"etcd"},"status":{"conditions":[{"type":"Available","status":"True"},{"type":"Degraded","status":"False"}]}}]}
EOF
    ;;
  *"get pods"*)
    cat <<'EOF'
{"apiVersion":"v1","kind":"List","items":[{"metadata":{"name":"nginx-7c5d4f8b9-x2kf4","namespace":"default","labels":{"app":"nginx"}},"status":{"phase":"Running","conditions":[{"type":"Ready","status":"True"}]}},{"metadata":{"name":"redis-5d8c9f7b6-m3lp7","namespace":"default","labels":{"app":"redis"}},"status":{"phase":"Running","conditions":[{"type":"Ready","status":"True"}]}}]}
EOF
    ;;
  *"get deployments"*)
    cat <<'EOF'
{"apiVersion":"v1","kind":"List","items":[{"metadata":{"name":"nginx","namespace":"default"},"spec":{"replicas":2},"status":{"readyReplicas":2,"availableReplicas":2}},{"metadata":{"name":"redis","namespace":"default"},"spec":{"replicas":1},"status":{"readyReplicas":1,"availableReplicas":1}}]}
EOF
    ;;
  *"get events"*)
    cat <<'EOF'
{"apiVersion":"v1","kind":"List","items":[{"metadata":{"name":"nginx.event1"},"involvedObject":{"name":"nginx-7c5d4f8b9-x2kf4","kind":"Pod"},"reason":"Scheduled","message":"Successfully assigned default/nginx to worker-0","type":"Normal","lastTimestamp":"2026-08-27T20:00:00Z"},{"metadata":{"name":"nginx.event2"},"involvedObject":{"name":"nginx-7c5d4f8b9-x2kf4","kind":"Pod"},"reason":"Started","message":"Started container nginx","type":"Normal","lastTimestamp":"2026-08-27T20:00:05Z"}]}
EOF
    ;;
  *"describe"*)
    echo "Name:         nginx-7c5d4f8b9-x2kf4"
    echo "Namespace:    default"
    echo "Status:       Running"
    echo "IP:           10.128.0.15"
    echo "Node:         worker-0"
    echo "Containers:"
    echo "  nginx:"
    echo "    Image:   registry.redhat.io/rhel9/nginx-124:latest"
    echo "    State:   Running"
    echo "    Ready:   True"
    echo "Events:"
    echo "  Normal  Scheduled  5m   default-scheduler  Successfully assigned"
    echo "  Normal  Started    5m   kubelet             Started container nginx"
    ;;
  *"logs"*)
    echo "2026-08-27T20:00:00Z 192.168.1.1 - - [27/Aug/2026:20:00:00 +0000] \"GET / HTTP/1.1\" 200 612"
    echo "2026-08-27T20:01:00Z 192.168.1.1 - - [27/Aug/2026:20:01:00 +0000] \"GET /healthz HTTP/1.1\" 200 2"
    ;;
  *"get"*"-o json"*)
    echo '{"apiVersion":"v1","kind":"List","items":[]}'
    ;;
  *)
    echo "mock oc: unrecognized command: $*" >&2
    exit 1
    ;;
esac
