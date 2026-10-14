"""会话压缩回归测试（离线，不调用真实 LLM）。

覆盖三处已确认缺陷，以及对应的修复：

1. ``_reported_tokens`` 遇到第一条没有 ``usage_metadata`` 的 AIMessage 就返回 0。
   本地构造 / 插件注入的消息会命中这一分支，于是 ``_should_summarize`` 永远判定
   "未超阈值"，**自动压缩静默失效**，会话一路涨到必须手动 ``/compact`` ——
   而手动压缩要把整段历史读一遍，正是最贵的那条路径。

2. 压缩写回的摘要被 ``_determine_cutoff_index`` 当成"一轮对话"。没有 SystemMessage
   时摘要写成首条 HumanMessage，于是"摘要 + 保留 N 轮"永远比 ``keep_rounds``
   多一轮，切点恒 > 0，**压缩后每回合都会再压一次**（每次都是一整轮模型调用）。

3. 手动 ``/compact`` 只推 ``compact_*`` 卡片事件、不推通用 ``done``。前端
   ``sendToChat`` 的 Promise 只在 ``done`` / ``interrupted`` / ``error`` 时 settle，
   因此它永不结束，``currentChatRequest`` 一直非 null，输入框永久卡在"发送中"——
   表现为"压缩完成后再也无法互动"。
"""
from __future__ import annotations

import asyncio
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from langchain_core.messages import (  # noqa: E402
    AIMessage,
    HumanMessage,
    SystemMessage,
)

from faust_backend.runtime.compact import (  # noqa: E402
    CompactMiddleware,
    _is_compact_summary,
    _reported_tokens,
)


# ── 测试替身 ──


class _FakeStream:
    """假模型：bind_tools / with_retry / astream（与 test_compact_middleware 一致）。"""

    _llm_type = "openai-chat"
    profile: dict = {}

    def __init__(self, *, summary: str = "## 目标与进度\n已压缩", fail: bool = False):
        self.summary = summary
        self.fail = fail
        self.calls: list[list] = []
        self.bound_log: list[list] = []

    def bind_tools(self, tools):
        clone = _FakeStream(summary=self.summary, fail=self.fail)
        clone.calls = self.calls
        clone.bound_log = self.bound_log
        clone.bound_log.append(list(tools))
        return clone

    def with_retry(self, **_kwargs):
        return self

    async def astream(self, payload, config=None):  # noqa: ANN001
        self.calls.append(list(payload))
        if self.fail:
            raise RuntimeError("上游 500")
        yield AIMessage(content=self.summary)


def _make_middleware(*, fake=None, keep_rounds: int = 1,
                     context_length: int = 1000,
                     threshold_ratio: float = 0.5) -> CompactMiddleware:
    fake = fake or _FakeStream()
    return CompactMiddleware(
        model=fake,
        compact_model=fake,
        tools=[],
        context_length=context_length,
        threshold_ratio=threshold_ratio,
        keep_rounds=keep_rounds,
    )


def _ai(content: str, *, tokens: int = 0) -> AIMessage:
    msg = AIMessage(content=content)
    if tokens:
        # 直接赋属性：构造期设 usage_metadata 与既有用法保持一致
        msg.usage_metadata = {  # type: ignore[assignment]
            "input_tokens": tokens,
            "output_tokens": 1,
            "total_tokens": tokens + 1,
        }
    return msg


def _summary(content: str = "【摘要】") -> HumanMessage:
    return HumanMessage(content=content, additional_kwargs={"lc_source": "faust_compact"})


# ── 1. API 用量提取：不能因为末尾消息没有 usage 就放弃 ──


def test_reported_tokens_skips_ai_without_usage():
    """末尾 AIMessage 没有 usage 时，应继续往前找真实上报值（而不是返回 0）。"""
    messages = [
        HumanMessage(content="早先请求"),
        _ai("早先回复", tokens=900_000),
        HumanMessage(content="最近请求"),
        _ai("本地构造的回复"),          # 无 usage_metadata
    ]
    assert _reported_tokens(messages) == 900_001


def test_reported_tokens_zero_when_no_usage_anywhere():
    """全都没有真实上报值时才返回 0（绝不本地估算）。"""
    assert _reported_tokens([HumanMessage(content="q"), _ai("a")]) == 0


def test_reported_tokens_ignores_non_ai_messages():
    messages = [_ai("a", tokens=500), HumanMessage(content="q")]
    assert _reported_tokens(messages) == 501


def test_reported_tokens_zero_on_empty():
    assert _reported_tokens([]) == 0


# ── 2. 轮次边界：压缩摘要不算一轮 ──


def test_is_compact_summary_marker():
    assert _is_compact_summary(_summary()) is True
    assert _is_compact_summary(HumanMessage(content="普通轮次")) is False
    assert _is_compact_summary(AIMessage(content="x")) is False


def test_cutoff_skips_when_only_old_summary_is_compressible():
    """只有「摘要 + 1 轮」时不应压缩：否则只是把摘要重新摘要一遍，白花一次调用。"""
    messages = [
        _summary(),
        HumanMessage(content="r1"),
        _ai("a1", tokens=100),
    ]
    mw = _make_middleware(keep_rounds=3)
    assert mw._determine_cutoff_index(messages) == 0


def test_cutoff_compacts_real_rounds_not_the_summary():
    """「摘要 + 3 轮」时切点必须落在真实轮次上，而不是把摘要本身当一轮。"""
    messages = [
        _summary(),
        HumanMessage(content="r1"),
        _ai("a1", tokens=100),
        HumanMessage(content="r2"),
        _ai("a2", tokens=100),
        HumanMessage(content="r3"),
        _ai("a3", tokens=100),
    ]
    mw = _make_middleware(keep_rounds=3)
    cutoff = mw._determine_cutoff_index(messages)
    # 修复前：摘要被算作第 1 轮 → len(round_starts)=4 > 3 → cutoff=1（只摘要摘要）
    assert cutoff != 1, "把摘要当成了可压缩轮次"
    # 真实轮次 3 个 = keep_rounds → 退化为只保留最后一轮，丢弃摘要与 r1/r2
    assert cutoff == messages.index(messages[5])
    assert not _is_compact_summary(messages[cutoff])


def test_cutoff_requires_a_real_discarded_round():
    """丢弃段里没有真实轮次时返回 0（System 与摘要都不算轮次）。"""
    messages = [
        SystemMessage(content="sys"),
        _summary(),
        HumanMessage(content="r1"),
        _ai("a1", tokens=100),
    ]
    mw = _make_middleware(keep_rounds=1)
    # round_starts = [2]，len <= keep_rounds → cutoff=2；丢弃段只有 sys+摘要 → 0
    assert mw._determine_cutoff_index(messages) == 0


# ── 3. /compact 必须发出终结事件（前端靠它释放请求状态） ──

TERMINAL_EVENTS = {"done", "interrupted", "error"}


class _FakeWS:
    def __init__(self) -> None:
        self.sent: list[str] = []

    async def send_text(self, text: str) -> None:
        self.sent.append(text)

    def event_types(self) -> list[str]:
        return [json.loads(t).get("type") for t in self.sent]


class _FakeCompactMW:
    def __init__(self, mode: str) -> None:
        self.mode = mode

    async def force_compact(self, messages, on_delta=None):  # noqa: ANN001
        if self.mode == "raise":
            raise RuntimeError("模拟压缩调用失败")
        if self.mode == "empty":
            return None
        if on_delta:
            await on_delta("## 目标与进度\n摘要")
        return {"messages": [HumanMessage(content="摘要")]}


class _FakeAgent:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail

    async def aupdate_state(self, config, update, as_node=None):  # noqa: ANN001
        if self.fail:
            raise RuntimeError("模拟 aupdate_state 失败")


async def _run_compact(mode: str, *, agent_fail: bool = False):
    from faust_backend.routes import chat as chat_route
    from faust_backend.runtime import state

    ws = _FakeWS()
    state.compact_middleware = _FakeCompactMW(mode)
    state.agent = _FakeAgent(fail=agent_fail)

    async def _messages():
        return [HumanMessage(content="hi")]

    original = chat_route.get_checkpoint_messages
    chat_route.get_checkpoint_messages = _messages
    try:
        handled, reply = await chat_route._handle_slash_command("/compact", ws)
    finally:
        chat_route.get_checkpoint_messages = original
    return handled, reply, ws


@pytest.mark.parametrize(
    "mode,agent_fail",
    [
        ("ok", False),        # 正常压缩
        ("empty", False),     # 没有可压缩的轮次
        ("ok", True),         # 写回 checkpoint 失败
        ("raise", False),     # 压缩调用抛异常
    ],
)
def test_compact_always_emits_terminal_event(mode, agent_fail):
    """四种结果都必须发终结事件，否则前端输入框会永久卡在"发送中"。"""
    handled, _reply, ws = asyncio.run(_run_compact(mode, agent_fail=agent_fail))
    types = ws.event_types()
    assert handled is True
    assert TERMINAL_EVENTS & set(types), f"缺少终结事件，前端会卡死: {types}"
    # 压缩卡片事件应照常推送
    assert "compact_start" in types
    assert "compact_done" in types


def test_compact_without_messages_still_terminates():
    """会话为空时也要给出卡片与终结事件，而不是静默无反应。"""
    from faust_backend.routes import chat as chat_route
    from faust_backend.runtime import state

    ws = _FakeWS()
    state.compact_middleware = _FakeCompactMW("ok")

    async def _no_messages():
        return []

    original = chat_route.get_checkpoint_messages
    chat_route.get_checkpoint_messages = _no_messages
    try:
        handled, _reply = asyncio.run(
            chat_route._handle_slash_command("/compact", ws)
        )
    finally:
        chat_route.get_checkpoint_messages = original

    types = ws.event_types()
    assert handled is True
    assert TERMINAL_EVENTS & set(types), types
    assert "compact_done" in types


def test_safe_send_swallows_closed_socket():
    """连接已断时发送不能抛异常，否则会杀死整个接收循环。"""
    from faust_backend.routes import chat as chat_route

    class _Dead:
        async def send_text(self, text):
            raise RuntimeError("socket closed")

    ok = asyncio.run(chat_route._safe_send(_Dead(), {"type": "done"}))
    assert ok is False
