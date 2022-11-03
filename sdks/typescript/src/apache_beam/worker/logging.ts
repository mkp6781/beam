/*
 * Licensed to the Apache Software Foundation (ASF) under one
 * or more contributor license agreements.  See the NOTICE file
 * distributed with this work for additional information
 * regarding copyright ownership.  The ASF licenses this file
 * to you under the Apache License, Version 2.0 (the
 * "License"); you may not use this file except in compliance
 * with the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as grpc from "@grpc/grpc-js";
import { startCapture } from "capture-console";
import { Queue } from "queue-typescript";

import { LogEntry, LogEntry_Severity_Enum } from "../proto/beam_fn_api";
import { BeamFnLoggingClient } from "../proto/beam_fn_api.grpc-client";


export function createLoggingChannel(workerId: string, endpoint: string) {
  const logQueue = new Queue<LogEntry>();
  function toEntry(line: string): LogEntry {
    const now_ms = Date.now();
    const seconds = Math.trunc(now_ms / 1000);
    return LogEntry.create({
      // TODO: Try to capture, or at least infer, the log level.
      severity: LogEntry_Severity_Enum.INFO,
      message: line,
      timestamp: {
        seconds: BigInt(seconds),
        nanos: Math.trunc((now_ms - seconds * 1000) * 1e6),
      },
    });
  }
  startCapture(process.stdout, (out) => logQueue.enqueue(toEntry(out)));
  startCapture(process.stderr, (out) => logQueue.enqueue(toEntry(out)));
  const metadata = new grpc.Metadata();
  metadata.add("worker_id", workerId);
  const client = new BeamFnLoggingClient(
    endpoint,
    grpc.ChannelCredentials.createInsecure(),
    {},
    {}
  );
  const channel = client.logging(metadata);

  return async function () {
    while (true) {
      if (logQueue.length) {
        const messages: LogEntry[] = [];
        while (logQueue.length && messages.length < 100) {
          messages.push(logQueue.dequeue());
        }
        await channel.write({ logEntries: messages });
      } else {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  };
}
